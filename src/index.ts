/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// 👇 Define the environment bindings (from your wrangler.toml)
interface Env {
  ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

// 👇 Types for JSON payloads
interface CompleteUploadRequest {
  key: string;
  uploadId: string;
  parts: { etag: string; partNumber: number }[];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ✅ Initialize S3 client for Cloudflare R2
    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });

    // 🧩 Step 1: Initiate multipart upload
    if (url.pathname === "/initiate") {
      const key = `uploads/${crypto.randomUUID()}.mp4`;
      const command = new CreateMultipartUploadCommand({
        Bucket: "videos",
        Key: key,
      });

      const res = await s3.send(command);

      return new Response(
        JSON.stringify({ uploadId: res.UploadId, key }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // 🧩 Step 2: Get signed URL for part upload
    if (url.pathname === "/sign-part") {
      const key = url.searchParams.get("key");
      const uploadId = url.searchParams.get("uploadId");
      const partNumber = Number(url.searchParams.get("partNumber"));

      if (!key || !uploadId || !partNumber) {
        return new Response("Missing parameters", { status: 400 });
      }

      const command = new UploadPartCommand({
        Bucket: "videos",
        Key: key,
        PartNumber: partNumber,
        UploadId: uploadId,
      });

      const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

      return new Response(JSON.stringify({ signedUrl }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 🧩 Step 3: Complete multipart upload
    if (url.pathname === "/complete") {
      const body = (await request.json()) as CompleteUploadRequest;

      if (!body.key || !body.uploadId || !body.parts?.length) {
        return new Response("Invalid request body", { status: 400 });
      }

      const command = new CompleteMultipartUploadCommand({
        Bucket: "videos",
        Key: body.key,
        UploadId: body.uploadId,
        MultipartUpload: {
          Parts: body.parts.map((p) => ({
            ETag: p.etag,
            PartNumber: p.partNumber,
          })),
        },
      });

      const result = await s3.send(command);

      return new Response(
        JSON.stringify({ location: result.Location }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response("Not found", { status: 404 });
  },
};
