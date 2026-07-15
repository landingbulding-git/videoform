import type { VercelRequest, VercelResponse } from '@vercel/node';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: process.env.AWS_REGION });

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { sessionId, stepId, contentType } = req.body ?? {};

  if (typeof sessionId !== 'string' || !ID_RE.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid sessionId' });
  }

  if (typeof stepId !== 'string' || !ID_RE.test(stepId)) {
    return res.status(400).json({ error: 'Invalid stepId' });
  }

  const allowedTypes = ['video/webm', 'video/mp4'];
  const finalContentType = allowedTypes.includes(contentType)
    ? contentType
    : 'video/webm';
  const ext = finalContentType === 'video/mp4' ? 'mp4' : 'webm';

  const key = `answers/${sessionId}/${stepId}.${ext}`;

  try {
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      ContentType: finalContentType,
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    const publicUrl = `${process.env.AWS_S3_PUBLIC_BASE_URL}/${key}`;

    return res.status(200).json({ uploadUrl, publicUrl });
  } catch (err) {
    console.error('Failed to create presigned URL', err);
    return res.status(500).json({ error: 'Failed to create upload URL' });
  }
}
