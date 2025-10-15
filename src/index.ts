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

// Helper: add CORS headers to a Response
function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*"); // replace * with your Pages domain for security
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, { ...response, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 🛡 Handle preflight CORS requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*", // or your domain
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // ✅ Initialize S3 client for Cloudflare R2
    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });

    try {
      // 🧩 Step 1: Initiate multipart upload
      if (url.pathname === "/initiate") {
        const key = `uploads/${crypto.randomUUID()}.mp4`;
        const command = new CreateMultipartUploadCommand({
          Bucket: "videos",
          Key: key,
        });

        const res = await s3.send(command);

        return withCors(
          new Response(JSON.stringify({ uploadId: res.UploadId, key }), {
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      // 🧩 Step 2: Get signed URL for part upload
      if (url.pathname === "/sign-part") {
        const key = url.searchParams.get("key");
        const uploadId = url.searchParams.get("uploadId");
        const partNumber = Number(url.searchParams.get("partNumber"));

        if (!key || !uploadId || !partNumber) {
          return withCors(new Response("Missing parameters", { status: 400 }));
        }

        const command = new UploadPartCommand({
          Bucket: "videos",
          Key: key,
          PartNumber: partNumber,
          UploadId: uploadId,
        });

        const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

        return withCors(
          new Response(JSON.stringify({ signedUrl }), {
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      // 🧩 Step 3: Complete multipart upload
      if (url.pathname === "/complete") {
        const body = (await request.json()) as CompleteUploadRequest;

        if (!body.key || !body.uploadId || !body.parts?.length) {
          return withCors(
            new Response("Invalid request body", { status: 400 })
          );
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

        return withCors(
          new Response(
            JSON.stringify({ location: result.Location }),
            { headers: { "Content-Type": "application/json" } }
          )
        );
      }

      return withCors(new Response("Not found", { status: 404 }));
    } catch (err: any) {
      return withCors(
        new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
  },
};
