// app/api/publicaciones/[id]/route.ts
import { NextResponse } from 'next/server';
import connectDB from '@/lib/dbConnect';
import Publicacion from '@/models/publicacion';
import { getServerSession } from 'next-auth';
import { getToken } from 'next-auth/jwt';
import { authOptions } from '@/lib/authOptions';
import { subirImagenBuffer } from '@/lib/uploadImage';

type ParamsPromise = { params: Promise<{ id: string }> };

const CATEGORIAS = new Set(['Limpieza', 'Electricidad', 'Jardinería', 'Plomería']);
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const MAX_IMAGE_MB = 4;

function isValidUrl(str: string) {
  try { new URL(str); return true; } catch { return false; }
}

async function getUserFromAuth(req: Request) {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    const id  = (session.user as any).id ?? (session as any).user?.sub ?? (session as any).user?.id;
    const rol = (session.user as any).rol;
    if (id) return { id: String(id), rol };
  }
  const jwt = await getToken({ req: req as any, secret: process.env.NEXTAUTH_SECRET });
  if (jwt) {
    const id  = (jwt as any).id ?? jwt.sub;
    const rol = (jwt as any).rol;
    if (id) return { id: String(id), rol };
  }
  return null;
}

function esAutor(pub: any, userId?: string) {
  return !!(pub && userId) && String(pub.trabajadorId) === String(userId);
}

// --- formato dd/MM/yyyy para las respuestas ---
function formatFechaCorta(fecha: string | Date | undefined | null) {
  if (!fecha) return null as any;
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return null as any;
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const anio = d.getFullYear();
  return `${dia}/${mes}/${anio}`;
}

function serializePub(pub: any) {
  const obj = pub?.toObject ? pub.toObject() : pub;
  return {
    ...obj,
    fecha: obj?.fecha ? formatFechaCorta(obj.fecha) : obj?.fecha ?? null,
  };
}

export async function GET(req: Request, { params }: ParamsPromise) {
  await connectDB();
  const { id } = await params;

  const user = await getUserFromAuth(req);
  if (!user) return NextResponse.json({ error: 'No autorizado (sin sesión)' }, { status: 401 });

  const pub = await Publicacion.findById(id);
  if (!pub) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
  if (!esAutor(pub, user.id)) return NextResponse.json({ error: 'Prohibido' }, { status: 403 });

  return NextResponse.json(serializePub(pub));
}

/**
 * PUT con soporte mixto:
 * - application/json: permite actualizar campos y, si viene imagen (URL), la guarda tal cual.
 * - multipart/form-data: permite actualizar campos + imagen (archivo). La imagen es opcional.
 */
export async function PUT(req: Request, { params }: ParamsPromise) {
  await connectDB();
  const { id } = await params;

  const user = await getUserFromAuth(req);
  if (!user) return NextResponse.json({ error: 'No autorizado (sin sesión)' }, { status: 401 });

  const pub = await Publicacion.findById(id);
  if (!pub) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
  if (!esAutor(pub, user.id)) return NextResponse.json({ error: 'Prohibido' }, { status: 403 });

  const ct = (req.headers.get('content-type') || '').toLowerCase();

  try {
    // ====== A) JSON (imagen como URL opcional) ======
    if (ct.includes('application/json')) {
      const body = await req.json();
      const { titulo, descripcion, categoria, imagen, precio, disponibilidad, fecha } = body ?? {};

      if (titulo !== undefined)         pub.titulo = String(titulo).trim();
      if (descripcion !== undefined)    pub.descripcion = String(descripcion).trim();
      if (categoria !== undefined && CATEGORIAS.has(String(categoria))) pub.categoria = String(categoria);
      if (imagen !== undefined) {
        const url = String(imagen).trim();
        if (url && !isValidUrl(url)) {
          return NextResponse.json({ error: 'URL de imagen inválida' }, { status: 400 });
        }
        if (url) pub.imagen = url; // si viene string vacío, lo ignoramos para no borrar accidental
      }
      if (precio !== undefined) {
        const p = Number(precio);
        if (!Number.isFinite(p) || p <= 0) return NextResponse.json({ error: 'Precio inválido' }, { status: 400 });
        pub.precio = p;
      }
      if (disponibilidad !== undefined) pub.disponibilidad = String(disponibilidad).trim();
      if (fecha !== undefined) {
        const d = new Date(String(fecha));
        pub.fecha = isNaN(d.getTime()) ? pub.fecha : d; // si no parsea, no lo cambia
      }

      await pub.save();
      return NextResponse.json(serializePub(pub));
    }

    // ====== B) MULTIPART (imagen archivo opcional; sube a Cloudinary) ======
    if (ct.includes('multipart/form-data')) {
      // ENV de Cloudinary solo necesarias si viene imagen archivo
      const form = await req.formData();

      const titulo         = form.get('titulo') as string | null;
      const descripcion    = form.get('descripcion') as string | null;
      const categoriaRaw   = form.get('categoria') as string | null;
      const imagenFile     = form.get('imagen') as File | null;
      const precioStr      = form.get('precio') as string | null;
      const disponibilidad = form.get('disponibilidad') as string | null;
      const fechaRaw       = form.get('fecha') as string | null;

      if (titulo !== null)         pub.titulo = titulo.trim();
      if (descripcion !== null)    pub.descripcion = descripcion.trim();
      if (categoriaRaw !== null && CATEGORIAS.has(categoriaRaw)) pub.categoria = categoriaRaw;

      if (precioStr !== null) {
        const p = Number(precioStr);
        if (!Number.isFinite(p) || p <= 0) return NextResponse.json({ error: 'Precio inválido' }, { status: 400 });
        pub.precio = p;
      }
      if (disponibilidad !== null) pub.disponibilidad = disponibilidad.trim();
      if (fechaRaw !== null) {
        const d = new Date(fechaRaw);
        pub.fecha = isNaN(d.getTime()) ? pub.fecha : d;
      }

      // Imagen opcional: solo procesar si realmente viene archivo y tiene size > 0
      if (imagenFile && typeof imagenFile !== 'string' && imagenFile.size > 0) {
        if (!imagenFile.type || !ALLOWED_MIME.has(imagenFile.type)) {
          return NextResponse.json({ error: 'Formato de imagen no permitido (JPG, PNG o WEBP)' }, { status: 400 });
        }
        if (imagenFile.size > MAX_IMAGE_MB * 1024 * 1024) {
          return NextResponse.json({ error: `Imagen supera ${MAX_IMAGE_MB}MB` }, { status: 413 });
        }

        // ENV requeridas para subir a Cloudinary
        for (const k of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
          if (!process.env[k]) {
            return NextResponse.json({ error: `Falta variable de entorno: ${k}` }, { status: 500 });
          }
        }

        const buffer = Buffer.from(await imagenFile.arrayBuffer());
        try {
          const up = await subirImagenBuffer(buffer, String(pub.trabajadorId), imagenFile.name);
          pub.imagen = up.secure_url;
          // Si guardas public_id, aquí podrías asignarlo y eliminar el anterior si aplica.
        } catch (e: any) {
          console.error('❌ Error Cloudinary (PUT):', e);
          return NextResponse.json(
            { error: 'Error al subir imagen a Cloudinary', detail: e?.message ?? String(e) },
            { status: 502 }
          );
        }
      }

      await pub.save();
      return NextResponse.json(serializePub(pub));
    }

    // Si no es JSON ni multipart
    return NextResponse.json(
      { error: 'Content-Type debe ser application/json o multipart/form-data' },
      { status: 415 }
    );
  } catch (err: any) {
    console.error('❌ PUT publicaciones error:', err);
    if (
      String(err?.code).includes('EntityTooLarge') ||
      String(err?.message || '').toLowerCase().includes('max')
    ) {
      return NextResponse.json({ error: `Archivo demasiado grande (máx ${MAX_IMAGE_MB}MB)` }, { status: 413 });
    }
    return NextResponse.json({ error: err?.message ?? 'Error interno' }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: ParamsPromise) {
  await connectDB();
  const { id } = await params;

  const user = await getUserFromAuth(req);
  if (!user) return NextResponse.json({ error: 'No autorizado (sin sesión)' }, { status: 401 });

  const pub = await Publicacion.findById(id);
  if (!pub) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
  if (!esAutor(pub, user.id)) return NextResponse.json({ error: 'Prohibido' }, { status: 403 });

  // (Opcional) si guardas public_id de Cloudinary, aquí podrías borrarlo con cloudinary.uploader.destroy(publicId)
  await pub.deleteOne();
  return NextResponse.json({ mensaje: 'Eliminado correctamente' });
}
