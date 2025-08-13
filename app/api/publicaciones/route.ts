// app/api/publicaciones/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getToken } from 'next-auth/jwt';
import { authOptions } from '@/lib/authOptions';

import dbConnect from '@/lib/dbConnect';
import Publicacion from '@/models/publicacion';
import { verifyToken } from '@/middlewares/verifyToken';
import { subirImagen } from '@/lib/uploadImage';

import formidable from 'formidable';
import { Readable } from 'stream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // este endpoint no debe cachearse

// ---- utils ----
function parseForm(req: Request, headers: Headers): Promise<[any, any]> {
  return new Promise((resolve, reject) => {
    const form = formidable({ multiples: false, keepExtensions: true });

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
  // 1) Sesión NextAuth (DB o JWT, vía getServerSession)
  const session = await getServerSession(authOptions);
  if (session?.user) {
    const id = (session.user as any).id ?? (session as any).user?.id ?? (session as any).user?.sub;
    const rol = (session.user as any).rol;
    if (id) return { id: String(id), rol };
  }

  // 2) JWT NextAuth (getToken) si usas strategy: 'jwt'
  const jwt = await getToken({ req: req as any, secret: process.env.NEXTAUTH_SECRET });
  if (jwt) {
    const id = (jwt as any).id ?? jwt.sub;
    const rol = (jwt as any).rol;
    if (id) return { id: String(id), rol };
  }

  // 3) Fallback a tu Bearer propio (compatibilidad)
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const raw = authHeader.split(' ')[1];
    const decoded: any = verifyToken(raw);
    if (decoded?.id) return { id: String(decoded.id), rol: decoded.rol };
  }

  return null;
}

// ---- POST ----
export async function POST(req: Request) {
  try {
    await dbConnect();

    const user = await getUserFromAuth(req);
    if (!user) {
      return NextResponse.json({ error: 'No autorizado (sesión o token ausente)' }, { status: 401 });
    }
    if (user.rol && user.rol !== 'trabajador') {
      return NextResponse.json({ error: 'No autorizado (solo trabajadores)' }, { status: 403 });
    }

    const [fields, files] = await parseForm(req, req.headers);

    const titulo          = fields.titulo?.[0];
    const descripcion     = fields.descripcion?.[0];
    const precioStr       = fields.precio?.[0];
    const disponibilidad  = fields.disponibilidad?.[0];
    const fecha           = fields.fecha?.[0];
    const categoria       = fields.categoria?.[0] || 'general';
    const file            = files.imagen?.[0];

    // Validaciones mínimas
    if (!titulo || !descripcion || !precioStr || !disponibilidad || !fecha || !file) {
      return NextResponse.json({ error: 'Faltan campos obligatorios' }, { status: 400 });
    }

    const precio = Number(precioStr);
    if (Number.isNaN(precio) || precio < 0) {
      return NextResponse.json({ error: 'Precio inválido' }, { status: 400 });
    }

    // (Opcional) Validar tipo/tamaño
    // if (!/^image\//.test(file.mimetype)) return NextResponse.json({ error: 'Archivo no es imagen' }, { status: 400 });
    // if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'Imagen > 5MB' }, { status: 400 });

    // Subir imagen
    const subida = await subirImagen(file.filepath, user.id);

    const nueva = await Publicacion.create({
      titulo,
      descripcion,
      precio,
      disponibilidad,
      fecha,
      categoria,
      imagen: subida.secure_url,
      trabajadorId: user.id,
    });

    return NextResponse.json(nueva, { status: 201 });
  } catch (err: any) {
    console.error('❌ Error al crear publicación:', err);
    return NextResponse.json({ error: err.message ?? 'Error interno' }, { status: 500 });
  }
}
