'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';

// "08/08/2025" -> "2025-08-08"
function ddmmyyyyToInput(fecha: string) {
  if (/^\d{4}-\d{2}-\d{2}/.test(fecha)) return fecha.slice(0, 10);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha);
  if (!m) return '';
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

// "2025-08-08" -> ISO
function inputToISO(fechaInput: string) {
  if (!fechaInput) return '';
  const d = new Date(fechaInput);
  if (isNaN(d.getTime())) return '';
  return d.toISOString();
}

// ENV de Cloudinary (unsigned)
const CLOUD_NAME   = process.env.NEXT_PUBLIC_CLOUD_NAME!;
const CLOUD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_PRESET!;

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
const MAX_MB = 4;

export default function EditarPublicacionPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const { status } = useSession();

  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [categoria, setCategoria] = useState('');
  const [precio, setPrecio] = useState('');
  const [disponibilidad, setDisponibilidad] = useState('');
  const [fecha, setFecha] = useState(''); // yyyy-MM-dd
  const [imagenURL, setImagenURL] = useState('');
  const [nuevaImagen, setNuevaImagen] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  // para limpiar blob URLs anteriores
  const prevBlobUrl = useRef<string | null>(null);

  // Redirige si no hay sesión
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  // Carga la publicación
  useEffect(() => {
    if (!id || status !== 'authenticated') return;

    (async () => {
      try {
        setCargando(true);
        setError('');

        const res = await fetch(`/api/publicaciones/${id}`, {
          cache: 'no-store',
          credentials: 'include',
        });
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || 'No se pudo cargar la publicación');
          setCargando(false);
          return;
        }

        setTitulo(data.titulo ?? '');
        setDescripcion(data.descripcion ?? '');
        setCategoria(data.categoria ?? '');
        setPrecio(String(data.precio ?? ''));
        setDisponibilidad(data.disponibilidad ?? '');
        setFecha(ddmmyyyyToInput(data.fecha ?? ''));
        setImagenURL(data.imagen ?? '');
        setPreview(data.imagen ?? '');
      } catch (e) {
        console.error(e);
        setError('Error al conectar con el servidor');
      } finally {
        setCargando(false);
      }
    })();
  }, [id, status]);

  // Limpieza de objectURL
  useEffect(() => {
    return () => {
      if (prevBlobUrl.current) {
        URL.revokeObjectURL(prevBlobUrl.current);
        prevBlobUrl.current = null;
      }
    };
  }, []);

  const validateImage = (file: File) => {
    if (!ALLOWED.includes(file.type)) return 'Formato no permitido (JPG, PNG o WEBP).';
    if (file.size > MAX_MB * 1024 * 1024) return `La imagen no debe pesar más de ${MAX_MB}MB.`;
    if (file.size === 0) return 'No se recibió archivo de imagen.';
    return '';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setMensaje('');
    setError('');

    if (!file) {
      setNuevaImagen(null);
      setPreview(imagenURL || null);
      return;
    }

    const v = validateImage(file);
    if (v) {
      setNuevaImagen(null);
      setPreview(imagenURL || null);
      setError(v);
      return;
    }

    setNuevaImagen(file);

    // preview con blob url
    const url = URL.createObjectURL(file);
    setPreview(url);

    // revoca blob anterior
    if (prevBlobUrl.current) URL.revokeObjectURL(prevBlobUrl.current);
    prevBlobUrl.current = url;
  };

  // Subir a Cloudinary (unsigned, desde cliente)
  const uploadToCloudinary = async (file: File): Promise<{ secure_url: string; public_id: string }> => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', CLOUD_PRESET);

    const resp = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: 'POST',
      body: fd,
    });

    const data = await resp.json();
    if (!resp.ok) {
      const msg = data?.error?.message || JSON.stringify(data).slice(0, 200);
      throw new Error(`Cloudinary: ${msg}`);
    }
    if (!data?.secure_url) {
      throw new Error('Cloudinary no devolvió secure_url');
    }
    return { secure_url: data.secure_url as string, public_id: data.public_id as string };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMensaje('');

    if (!titulo.trim()) return setError('El título es obligatorio');
    if (!descripcion.trim()) return setError('La descripción es obligatoria');
    if (precio && Number.isNaN(Number(precio))) return setError('Precio inválido');

    try {
      setGuardando(true);
      let urlImagen = imagenURL;

      // Si eligió nueva imagen, súbela primero
      if (nuevaImagen) {
        const up = await uploadToCloudinary(nuevaImagen);
        urlImagen = up.secure_url;
      }

      const fechaEnviar = fecha ? inputToISO(fecha) : undefined;

      const res = await fetch(`/api/publicaciones/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          titulo,
          descripcion,
          precio: precio ? Number(precio) : undefined,
          disponibilidad,
          fecha: fechaEnviar,
          categoria,
          imagen: urlImagen, // si no cambiaste la imagen, manda la existente
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al actualizar');
      }

      setMensaje('✅ Publicación actualizada');
      setTimeout(() => router.push('/dashboard/trabajador'), 1200);
    } catch (err: any) {
      setError(err?.message || 'Error inesperado');
    } finally {
      setGuardando(false);
    }
  };

  if (status === 'loading' || cargando) {
    return <div className="max-w-2xl mx-auto p-6 mt-10">Cargando…</div>;
  }
  if (status === 'unauthenticated') return null;

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 px-4 sm:px-6">
      <div className="bg-white shadow-xl rounded-2xl p-6 sm:p-8 w-full max-w-2xl border border-gray-100">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-center mb-6 bg-clip-text text-transparent bg-gradient-to-r from-purple-600 to-blue-600">
          Editar publicación
        </h1>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}
        {mensaje && (
          <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-700 text-sm">
            {mensaje}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Título */}
          <div>
            <input
              type="text"
              placeholder="Título del servicio"
              className="w-full rounded-lg px-3 py-2 border text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 border-gray-300"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              required
            />
          </div>

          {/* Descripción */}
          <div>
            <textarea
              rows={4}
              placeholder="Descripción del servicio"
              className="w-full rounded-lg px-3 py-2 border text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 border-gray-300 resize-none"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              required
            />
          </div>

          {/* Precio y Disponibilidad */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Precio (MXN)"
              className="w-full rounded-lg px-3 py-2 border text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 border-gray-300"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
            />
            <input
              type="text"
              placeholder="Disponibilidad (ej. Mañanas, 9-14h)"
              className="w-full rounded-lg px-3 py-2 border text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 border-gray-300"
              value={disponibilidad}
              onChange={(e) => setDisponibilidad(e.target.value)}
            />
          </div>

          {/* Fecha y Categoría */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <input
              type="date"
              className="w-full rounded-lg px-3 py-2 border text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 border-gray-300"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="w-full rounded-lg px-3 py-2 border text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 border-gray-300 bg-white"
            >
              <option value="" disabled>Selecciona una categoría</option>
              <option value="Limpieza">Limpieza</option>
              <option value="Electricidad">Electricidad</option>
              <option value="Jardinería">Jardinería</option>
              <option value="Plomería">Plomería</option>
            </select>
          </div>

          {/* Imagen */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Imagen</label>
            <div className="flex items-center gap-3">
              <input
                type="file"
                id="imagenInput"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <label
                htmlFor="imagenInput"
                className="inline-block bg-gradient-to-r from-purple-500 to-blue-500 text-white px-4 py-2 rounded-full text-sm shadow hover:opacity-90 cursor-pointer transition"
              >
                Elegir imagen
              </label>
              {(nuevaImagen || imagenURL) && (
                <span className="text-xs text-gray-600 truncate max-w-[200px]">
                  {nuevaImagen ? nuevaImagen.name : (imagenURL.split('/').pop() || 'imagen')}
                </span>
              )}
            </div>

            {preview && (
              <img
                src={preview}
                alt="Vista previa"
                className="w-full max-h-64 object-cover mt-4 rounded-lg border border-gray-200"
              />
            )}
          </div>

          {/* Botón */}
          <button
            type="submit"
            disabled={guardando}
            className="w-full bg-gradient-to-r from-purple-500 to-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white py-3 rounded-lg text-base sm:text-lg font-semibold hover:from-purple-600 hover:to-blue-600 transition shadow"
          >
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </form>
      </div>
    </main>
  );
}
