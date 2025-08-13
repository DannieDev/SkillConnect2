// app/api/publicaciones/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getToken } from 'next-auth/jwt';
import { authOptions } from '@/lib/authOptions';

import dbConnect from '@/lib/dbConnect';
import Publicacion from '@/models/publicacion';
import { verifyToken } from '@/middlewares/verifyToken';
import { subirImagen } from '@/lib/uploadImage';

import formidable, { File as FormidableFile, Fields, Files } from 'formidable';
import os from 'os';
import { Readable } from 'stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// --- util: parse multipart con formidable ---
function parseForm(req: Request, headers: Headers): Promise<[Fields, Files]> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      multiples: false,
      keepExtensions: true,
      uploadDir: os.tmpdir(),
      maxFileSize: 5 * 1024 * 1024, // 5MB
      filter: ({ mimetype }) => !!mimetype && mimetype.startsWith('image/'),
    });

    const stream = Readable.fromWeb(req.body as any);
    const nodeReq: any = stream;
    nodeReq.headers = Object.fromEntries(headers.entries());

    form.parse(nodeReq, (err, fields, files) => {
      if (err) return reject(err);
      resolve([fields, files]);
    });
  });
}

async function getUserFromAuth(req: Request) {
  // 1) Sesión NextAuth (App Router)
  const session = await getServerSession(authOptions);
  if (session?.user) {
    const id = (session.user as any).id ?? (session as any).user?.sub ?? (session as any).user?.id;
    const rol = (session.user as any).rol;
    if (id) return { id: String(id), rol };
  }

  // 2) JWT de NextAuth
  const jwt = await getToken({ req: req as any, secret: process.env.NEXTAUTH_SECRET });
  if (jwt) {
    const id = (jwt as any).id ?? jwt.sub;
    const rol = (jwt as any).rol;
    if (id) return { id: String(id), rol };
  }

  // 3) Bearer propio
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const raw = authHeader.split(' ')[1];
    const decoded: any = verifyToken(raw);
    if (decoded?.id) return { id: String(decoded.id), rol: decoded.rol };
  }

  return null;
}

// --- helpers de validación ---
const CATEGORIAS = new Set(['Limpieza', 'Electricidad', 'Jardinería', 'Plomería']);
const isValidDate = (d: string) => !Number.isNaN(Date.parse(d));
const isPastDate = (d: string) => new Date(d).setHours(0,0,0,0) < new Date().setHours(0,0,0,0);
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

// --- util: fecha estilo "Thu Jul 31 2025" (sin hora/zonas visibles) ---
function formatDateEnLike(d: string | Date, tz = 'America/Hermosillo') {
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: tz,
  }).formatToParts(new Date(d)) as Intl.DateTimeFormatPart[];
  const pick = (t: Intl.DateTimeFormatPart['type']) => parts.find(p => p.type === t)?.value ?? '';
  return `${pick('weekday')} ${pick('month')} ${pick('day')} ${pick('year')}`.trim();
}

// ---- POST ----
export async function POST(req: Request) {
  try {
    // Solo multipart
    const ct = req.headers.get('content-type') || '';
    if (!ct.toLowerCase().includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Content-Type debe ser multipart/form-data' }, { status: 415 });
    }

    await dbConnect();

    const user = await getUserFromAuth(req);
    if (!user) {
      return NextResponse.json({ error: 'No autorizado (sesión o token ausente)' }, { status: 401 });
    }
    if (user.rol && user.rol !== 'trabajador') {
      return NextResponse.json({ error: 'No autorizado (solo trabajadores)' }, { status: 403 });
    }

    const [fields, files] = await parseForm(req, req.headers);

    const titulo          = (fields.titulo?.[0] as string | undefined)?.trim();
    const descripcion     = (fields.descripcion?.[0] as string | undefined)?.trim();
    const precioStr       = (fields.precio?.[0] as string | undefined)?.trim();
    const disponibilidad  = (fields.disponibilidad?.[0] as string | undefined)?.trim();
    const fecha           = (fields.fecha?.[0] as string | undefined)?.trim();
    const categoriaRaw    = (fields.categoria?.[0] as string | undefined)?.trim();
    const file            = (files.imagen?.[0] as FormidableFile | undefined);

    // Requeridos
    if (!titulo || !descripcion || !precioStr || !disponibilidad || !fecha || !file) {
      return NextResponse.json({ error: 'Faltan campos obligatorios' }, { status: 400 });
    }

    // Precio
    const precio = Number(precioStr);
    if (!Number.isFinite(precio) || precio <= 0) {
      return NextResponse.json({ error: 'Precio inválido' }, { status: 400 });
    }

    // Fecha
    if (!isValidDate(fecha)) {
      return NextResponse.json({ error: 'Fecha inválida' }, { status: 400 });
    }
    if (isPastDate(fecha)) {
      return NextResponse.json({ error: 'La fecha no puede ser pasada' }, { status: 400 });
    }
    const fechaISO = new Date(fecha).toISOString();

    // Categoría
    const categoria = categoriaRaw && CATEGORIAS.has(categoriaRaw) ? categoriaRaw : 'general';

    // Imagen (tipo/tamaño)
    if (!file?.mimetype || !ALLOWED_MIME.has(file.mimetype)) {
      return NextResponse.json({ error: 'Formato de imagen no permitido (usa JPG, PNG o WEBP)' }, { status: 400 });
    }
    if (file.size && file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Imagen supera 5MB' }, { status: 400 });
    }

    // Subir imagen (Cloud, etc.)
    const subida = await subirImagen(file.filepath, user.id);

    // Persistir (guardar como Date/ISO en BD)
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

    // ⛳ Serialización manual: devolvemos fecha como "Thu Jul 31 2025"
    const salida = {
      _id: String(nueva._id),
      titulo: nueva.titulo,
      descripcion: nueva.descripcion,
      precio: nueva.precio,
      disponibilidad: nueva.disponibilidad,
      fecha: formatDateEnLike(nueva.fecha), // <- forzada al formato deseado
      categoria: nueva.categoria,
      imagen: nueva.imagen,
      trabajadorId: String(nueva.trabajadorId),
      createdAt: nueva.createdAt,
      updatedAt: nueva.updatedAt,
    };

    return NextResponse.json(salida, { status: 201 });
  } catch (err: any) {
    console.error('❌ Error al crear publicación:', err);
    if (String(err?.code).includes('EntityTooLarge') || String(err?.message).toLowerCase().includes('maxfilesize')) {
      return NextResponse.json({ error: 'Archivo demasiado grande (máx 5MB)' }, { status: 413 });
    }
    return NextResponse.json({ error: err?.message ?? 'Error interno' }, { status: 500 });
  }
}
