import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

// Tuify PaaS injects: S3_ENDPOINT, S3_BUCKET, S3_PUBLIC_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
// Fallback to legacy AWS_ENDPOINT_URL / AWS_BUCKET for local dev or other providers.
const endpoint  = () => process.env.S3_ENDPOINT        || process.env.AWS_ENDPOINT_URL;
const bucket    = () => process.env.S3_BUCKET          || process.env.AWS_BUCKET || 'tuify-assets';

function client() {
  const ep = endpoint();
  const cfg = {
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  };
  if (ep) {
    cfg.endpoint = ep;
    cfg.forcePathStyle = true; // required for MinIO / PaaS S3
  }
  return new S3Client(cfg);
}

export const s3Driver = {
  async upload(buffer, filename, mimeType) {
    const bkt = bucket();
    const key = `assets/${filename}`;
    await client().send(new PutObjectCommand({
      Bucket: bkt,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ACL: 'public-read',
    }));
    // Public URL priority:
    //  1. CDN_BASE_URL  — PaaS injects this as the full public base including bucket
    //  2. S3_PUBLIC_URL/bucket — PaaS public domain + bucket path
    //  3. endpoint/bucket — MinIO path-style fallback
    const ep = endpoint();
    const cdnBase = (
      process.env.CDN_BASE_URL ||
      (process.env.S3_PUBLIC_URL ? `${process.env.S3_PUBLIC_URL}/${bkt}` : null) ||
      (ep ? `${ep}/${bkt}` : `https://${bkt}.s3.amazonaws.com`)
    ).replace(/\/$/, '');
    return { url: `${cdnBase}/${key}`, key };
  },

  async delete(key) {
    await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  },
};
