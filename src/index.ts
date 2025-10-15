import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

interface Env {
  ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

interface CompleteUploadRequest {
  key: string;
  uploadId: string;
  parts: { etag: string; partNumber: number }[];
}

// Add CORS headers to every response
function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*"); // replace "*" with your Pages domain in production
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, { ...response, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    console.log("=== Incoming request ===");
    console.log("Method:", request.method);
    console.log("URL:", request.url);

    const url = new URL(request.url);

    // Handle preflight requests
    if (request.method === "OPTIONS") {
      console.log("Handling OPTIONS preflight");
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // Initialize S3 client
    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });

    try {
      // STEP 1: Initiate multipart upload
      if (url.pathname === "/initiate") {
        const key = `uploads/${crypto.randomUUID()}.mp4`;
        console.log("[INITIATE] Generated key:", key);

        const command = new CreateMultipartUploadCommand({ Bucket: "large-video-uploads", Key: key });
        const res = await s3.send(command);

        console.log("[INITIATE] S3 response:", res);

        return withCors(
          new Response(JSON.stringify({ uploadId: res.UploadId, key }), {
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      // STEP 2: Get signed URL for a part
      if (url.pathname === "/sign-part") {
        const key = url.searchParams.get("key");
        const uploadId = url.searchParams.get("uploadId");
        const partNumber = Number(url.searchParams.get("partNumber"));

        console.log("[SIGN-PART] Received key:", key, "uploadId:", uploadId, "partNumber:", partNumber);

        if (!key || !uploadId || !partNumber) {
          console.warn("[SIGN-PART] Missing parameters");
          return withCors(new Response("Missing parameters", { status: 400 }));
        }

        const command = new UploadPartCommand({ Bucket: "large-video=uploads", Key: key, PartNumber: partNumber, UploadId: uploadId });
        const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });

        console.log("[SIGN-PART] Signed URL generated:", signedUrl.substring(0, 60) + "..."); // Truncate for log

        return withCors(
          new Response(JSON.stringify({ signedUrl }), {
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      // STEP 3: Complete multipart upload
      if (url.pathname === "/complete") {
        const body = (await request.json()) as CompleteUploadRequest;

        console.log("[COMPLETE] Request body:", body);

        if (!body.key || !body.uploadId || !body.parts?.length) {
          console.warn("[COMPLETE] Invalid request body");
          return withCors(new Response("Invalid request body", { status: 400 }));
        }

        const command = new CompleteMultipartUploadCommand({
          Bucket: "large-video-uploads",
          Key: body.key,
          UploadId: body.uploadId,
          MultipartUpload: { Parts: body.parts.map(p => ({ ETag: p.etag, PartNumber: p.partNumber })) },
        });

        const result = await s3.send(command);
        console.log("[COMPLETE] S3 complete response:", result);

        return withCors(
          new Response(JSON.stringify({ location: result.Location, key: body.key }), {
            headers: { "Content-Type": "application/json" },
          })
        );
      }

      console.warn("[FETCH] Path not found:", url.pathname);
      return withCors(new Response("Not found", { status: 404 }));
    } catch (err: any) {
      console.error("[ERROR]", err);
      return withCors(
        new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
  },
};
