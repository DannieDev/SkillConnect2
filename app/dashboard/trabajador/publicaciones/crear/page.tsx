'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import axios from 'axios';

type FieldErrors = Partial<Record<
  'titulo' | 'descripcion' | 'precio' | 'disponibilidad' | 'fecha' | 'categoria' | 'imagen',
  string
>>;

// === formateador "Thu Jul 31 2025" (mismo que backend) ===
function formatDateEnLike(d: string | Date, tz = 'America/Hermosillo') {
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: tz,
  }).formatToParts(new Date(d)) as Intl.DateTimeFormatPart[];
  const get = (t: Intl.DateTimeFormatPart['type']) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('month')} ${get('day')} ${get('year')}`.trim();
}

// "yyyy-MM-dd" -> ISO (evita problemas de huso horario)
function inputDateToISO(yyyy_mm_dd: string) {
  const d = new Date(yyyy_mm_dd);
  if (isNaN(d.getTime())) return yyyy_mm_dd; // fallback sin romper
  return d.toISOString();
}

export default function CrearPublicacionPage() {
  const router = useRouter();

  const [titulo, setTitulo] = useState('');
  const [precio, setPrecio] = useState('');           // se envía como string pero validamos número
  const [disponibilidad, setDisponibilidad] = useState('');
  const [fecha, setFecha] = useState('');             // yyyy-MM-dd desde el input
  const [descripcion, setDescripcion] = useState('');
  const [categoria, setCategoria] = useState('');     // ⬅ placeholder real
  const [imagen, setImagen] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const validateImage = (file: File) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    const maxMB = 5;
    if (!allowed.includes(file.type)) return 'Formato no permitido (usa JPG, PNG o WEBP).';
    if (file.size > maxMB * 1024 * 1024) return `La imagen no debe pesar más de ${maxMB}MB.`;
    return '';
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setFieldErrors((prev) => ({ ...prev, imagen: '' }));
    if (file) {
      const imgErr = validateImage(file);
      if (imgErr) {
        setImagen(null);
        setPreview(null);
        setFieldErrors((prev) => ({ ...prev, imagen: imgErr }));
        return;
      }
      setImagen(file);
      const reader = new FileReader();
      reader.onloadend = () => setPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const validate = () => {
    const errs: FieldErrors = {};
    if (!titulo.trim()) errs.titulo = 'El título es obligatorio.';
    if (!descripcion.trim()) errs.descripcion = 'La descripción es obligatoria.';
    if (!precio) errs.precio = 'El precio es obligatorio.';
    else if (isNaN(Number(precio)) || Number(precio) <= 0) errs.precio = 'Ingresa un precio válido.';
    if (!disponibilidad.trim()) errs.disponibilidad = 'La disponibilidad es obligatoria.';
    if (!fecha) errs.fecha = 'La fecha es obligatoria.';
    if (!categoria) errs.categoria = 'Selecciona una categoría.';
    if (!imagen) errs.imagen = 'Debes subir una imagen.';
    return errs;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensaje('');
    setError('');
    setFieldErrors({});

    const errs = validate();
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setError('Revisa los campos marcados.');
      return;
    }

    const formData = new FormData();
    formData.append('titulo', titulo.trim());
    formData.append('precio', precio.trim());
    formData.append('disponibilidad', disponibilidad.trim());
    // Enviamos ISO (backend lo guarda como Date y puede devolver formateado)
    formData.append('fecha', inputDateToISO(fecha));
    formData.append('descripcion', descripcion.trim());
    formData.append('categoria', categoria);
    if (imagen) formData.append('imagen', imagen);

    try {
      setSubmitting(true);
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const res = await axios.post('/api/publicaciones', formData, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        withCredentials: true, // ⬅️ por si tu auth va por cookies (NextAuth)
      });

      // Si el backend devuelve fecha ya formateada, úsala tal cual;
      // si viniera ISO, la formateamos aquí para el mensaje.
      const fechaResp = res?.data?.fecha as string | undefined;
      const bonita =
        fechaResp
          ? (fechaResp.includes('T') ? formatDateEnLike(fechaResp) : fechaResp)
          : formatDateEnLike(inputDateToISO(fecha));

      setMensaje(`✅ Publicación creada con fecha ${bonita}`);
      setTimeout(() => router.push('/dashboard/trabajador'), 1200);
    } catch (err: any) {
      console.error('Error al crear publicación:', err);
      const apiMsg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        'Error al crear la publicación';
      setError(apiMsg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 px-4 sm:px-6">
      <div className="bg-white shadow-xl rounded-2xl p-6 sm:p-8 w-full max-w-2xl border border-gray-100">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-center mb-6 bg-clip-text text-transparent bg-gradient-to-r from-purple-600 to-blue-600">
          Crear nueva publicación
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
              className={`w-full rounded-lg px-3 py-2 border text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 ${
                fieldErrors.titulo ? 'border-red-400' : 'border-gray-300'
              }`}
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
            />
            {fieldErrors.titulo && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.titulo}</p>
            )}
          </div>

          {/* Descripción */}
          <div>
            <textarea
              rows={4}
              placeholder="Descripción del servicio"
              className={`w-full rounded-lg px-3 py-2 border text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 ${
                fieldErrors.descripcion ? 'border-red-400' : 'border-gray-300'
              }`}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
            />
            {fieldErrors.descripcion && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.descripcion}</p>
            )}
          </div>

          {/* Precio y Disponibilidad */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <input
                type="number"
                min="1"
                step="0.01"
                placeholder="Precio (MXN)"
                className={`w-full rounded-lg px-3 py-2 border text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 ${
                  fieldErrors.precio ? 'border-red-400' : 'border-gray-300'
                }`}
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
              />
              {fieldErrors.precio && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.precio}</p>
              )}
            </div>

            <div>
              <input
                type="text"
                placeholder="Disponibilidad (ej. Mañanas, 9-14h)"
                className={`w-full rounded-lg px-3 py-2 border text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 ${
                  fieldErrors.disponibilidad ? 'border-red-400' : 'border-gray-300'
                }`}
                value={disponibilidad}
                onChange={(e) => setDisponibilidad(e.target.value)}
              />
              {fieldErrors.disponibilidad && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.disponibilidad}</p>
              )}
            </div>
          </div>

          {/* Fecha y Categoría */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <input
                type="date"
                className={`w-full rounded-lg px-3 py-2 border text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 ${
                  fieldErrors.fecha ? 'border-red-400' : 'border-gray-300'
                }`}
                value={fecha}
                min={today}
                onChange={(e) => setFecha(e.target.value)}
              />
              {fieldErrors.fecha && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.fecha}</p>
              )}
            </div>

            <div>
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className={`w-full rounded-lg px-3 py-2 border text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 ${
                  fieldErrors.categoria ? 'border-red-400' : 'border-gray-300'
                }`}
              >
                <option value="" disabled>
                  Selecciona una categoría
                </option>
                <option value="Limpieza">Limpieza</option>
                <option value="Electricidad">Electricidad</option>
                <option value="Jardinería">Jardinería</option>
                <option value="Plomería">Plomería</option>
              </select>
              {fieldErrors.categoria && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.categoria}</p>
              )}
            </div>
          </div>

          {/* Imagen */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Imagen</label>
            <div className="flex items-center gap-3">
              <input
                type="file"
                id="imagenInput"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
              />
              <label
                htmlFor="imagenInput"
                className="inline-block bg-gradient-to-r from-purple-500 to-blue-500 text-white px-4 py-2 rounded-full text-sm shadow hover:opacity-90 cursor-pointer transition"
              >
                Elegir imagen
              </label>
              {imagen && (
                <span className="text-xs text-gray-600 truncate max-w-[200px]">
                  {imagen.name}
                </span>
              )}
            </div>
            {fieldErrors.imagen && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.imagen}</p>
            )}
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
            disabled={submitting}
            className="w-full bg-gradient-to-r from-purple-500 to-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white py-3 rounded-lg text-base sm:text-lg font-semibold hover:from-purple-600 hover:to-blue-600 transition shadow"
          >
            {submitting ? 'Publicando…' : 'Publicar'}
          </button>
        </form>
      </div>
    </main>
  );
}
