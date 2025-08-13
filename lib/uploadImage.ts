import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key:    process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
  secure: true,
});

type UploadResult = { secure_url: string; public_id: string };

export async function subirImagenBuffer(
  buffer: Buffer,
  userId: string,
  filename?: string
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `usuarios/${userId}`,
        resource_type: 'image',
        filename_override: filename,
        overwrite: true,
        timeout: 60_000,
      },
      (err, result) => {
        if (err) return reject(err);
        if (!result) return reject(new Error('Respuesta vacía de Cloudinary'));
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      }
    );
    stream.end(buffer);
  });
}
