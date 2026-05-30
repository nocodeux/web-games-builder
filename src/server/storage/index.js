import { localDriver } from './localDriver.js';
import { s3Driver } from './s3Driver.js';

export function getStorageDriver() {
  // Auto-activate S3 when a custom endpoint is injected (PaaS / MinIO), or via explicit flag.
  const useS3 = process.env.STORAGE_DRIVER === 's3'
    || !!process.env.S3_ENDPOINT
    || !!process.env.AWS_ENDPOINT_URL;
  return useS3 ? s3Driver : localDriver;
}
