// app/api/publicaciones/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getToken } from 'next-auth/jwt';
import { authOptions } from '@/lib/authOptions';

import dbConnect from '@/lib/dbConnect';
import Publicacion from '@/models/publicacion';
import { verifyToken } from '@/middlewares/verifyToken';
import { subirImagenBuffer } from '@/lib/uploadImage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getUserFromAuth(req: Request) {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    const id = (session.user as any).id ?? (session as any).user?.sub ?? (session as any).user?.id;
    const rol = (session.user as any).rol;
    if (id) return { id: String(id), rol };
  }
  const jwt = await getToken({ req: req as any, secret: process.env.NEXTAUTH_SECRET });
  if (jwt) {
    const id = (jwt as any).id ?? jwt.sub;
    const rol = (jwt as any).rol;
    if (id) return { id: String(id), rol };
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const raw = authHeader.split(' ')[1];
    const decoded: any = verifyToken(raw);
    if (decoded?.id) return { id: String(decoded.id), rol: decoded.rol };
  }
  return null;
}

const CATEGORIAS = new Set(['Limpieza', 'Electricidad', 'Jardinería', 'Plomería']);
const isValidDate = (d: string) => !Number.isNaN(Date.parse(d));
const isPastDate = (d: string) => new Date(d).setHours(0,0,0,0) < new Date().setHours(0,0,0,0);
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_IMAGE_MB = 4; // ⬅️ bajar a 4MB por límite de Netlify Functions (~6MB request)

export async function POST(req: Request) {
  try {
    const ct = req.headers.get('content-type') || '';
    if (!ct.toLowerCase().includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Content-Type debe ser multipart/form-data' }, { status: 415 });
    }

    for (const k of ['MONGODB_URI','CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET','NEXTAUTH_SECRET']) {
      if (!process.env[k]) {
        return NextResponse.json({ error: `Falta variable de entorno: ${k}` }, { status: 500 });
      }
    }

    await dbConnect();

    const user = await getUserFromAuth(req);
    if (!user) return NextResponse.json({ error: 'No autorizado (sesión o token ausente)' }, { status: 401 });
    if (user.rol && user.rol !== 'trabajador') {
      return NextResponse.json({ error: 'No autorizado (solo trabajadores)' }, { status: 403 });
    }

    const form = await req.formData();

    const titulo         = (form.get('titulo') as string | null)?.trim();
    const descripcion    = (form.get('descripcion') as string | null)?.trim();
    const precioStr      = (form.get('precio') as string | null)?.trim();
    const disponibilidad = (form.get('disponibilidad') as string | null)?.trim();
    const fecha          = (form.get('fecha') as string | null)?.trim();
    const categoriaRaw   = (form.get('categoria') as string | null)?.trim();
    const file           = form.get('imagen') as File | null;

    if (!titulo || !descripcion || !precioStr || !disponibilidad || !fecha || !file) {
      return NextResponse.json({ error: 'Faltan campos obligatorios' }, { status: 400 });
    }

    const precio = Number(precioStr);
    if (!Number.isFinite(precio) || precio <= 0) {
      return NextResponse.json({ error: 'Precio inválido' }, { status: 400 });
    }

    if (!isValidDate(fecha)) {
      return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 });
    }
    if (isPastDate(fecha)) {
      return NextResponse.json({ error: 'La fecha no puede ser pasada' }, { status: 400 });
    }
    const fechaISO = new Date(fecha).toISOString();

    const categoria = categoriaRaw && CATEGORIAS.has(categoriaRaw) ? categoriaRaw : 'general';

    // Validación de imagen reforzada para Netlify
    if (!file.type || !ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: 'Formato de imagen no permitido (JPG, PNG o WEBP)' }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'No se recibió archivo de imagen' }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      return NextResponse.json({ error: `Imagen supera ${MAX_IMAGE_MB}MB` }, { status: 413 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let subida: { secure_url: string; public_id: string };
    try {
      subida = await subirImagenBuffer(buffer, user.id, file.name);
    } catch (e: any) {
      console.error('❌ Error Cloudinary:', e);
      return NextResponse.json(
        { error: 'Error al subir imagen a Cloudinary', detail: e?.message ?? String(e) },
        { status: 502 }
      );
    }

    const nueva = await Publicacion.create({
      titulo,
      descripcion,
      precio,
      disponibilidad,
      fecha: fechaISO,
      categoria,
      imagen: subida.secure_url,
      trabajadorId: user.id,
    });

    return NextResponse.json(nueva, { status: 201 });
  } catch (err: any) {
    console.error('❌ Error al crear publicación:', err);
    if (
      String(err?.code).includes('EntityTooLarge') ||
      String(err?.message || '').toLowerCase().includes('max')
    ) {
      return NextResponse.json({ error: `Archivo demasiado grande (máx ${MAX_IMAGE_MB}MB)` }, { status: 413 });
    }
    return NextResponse.json({ error: err?.message ?? 'Error interno' }, { status: 500 });
  }
}
