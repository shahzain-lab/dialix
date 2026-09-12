import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { env } from "./env.js";

const useS3 = Boolean(env.S3_ACCESS_KEY && env.S3_SECRET_KEY && env.S3_BUCKET);

const s3 = useS3
  ? new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: Boolean(env.S3_ENDPOINT),
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    })
  : null;

export async function putFile(key: string, body: Buffer, contentType: string): Promise<void> {
  if (s3) {
    await s3.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return;
  }
  const path = join(env.UPLOAD_DIR, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}

export async function getFile(key: string): Promise<Buffer> {
  if (s3) {
    const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error("Empty object");
    return Buffer.from(bytes);
  }
  return readFile(join(env.UPLOAD_DIR, key));
}

export async function deleteFile(key: string): Promise<void> {
  if (s3) {
    await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return;
  }
  const { unlink } = await import("node:fs/promises");
  await unlink(join(env.UPLOAD_DIR, key)).catch(() => undefined);
}
