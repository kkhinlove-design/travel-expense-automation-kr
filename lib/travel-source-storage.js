export async function uploadTravelSourceObject(bucket, objectKey, file, contentType) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new TypeError("업로드할 원본 파일을 읽을 수 없습니다.");
  }

  // storage-js는 Blob/File을 받으면 multipart의 파일 자체 MIME을 사용한다.
  // Windows에서 선택한 PDF/HWPX의 file.type이 비어 있으면, options.contentType을
  // 지정해도 비공개 버킷의 MIME allowlist에서 400으로 거절될 수 있다.
  // 바이트 배열로 전송하면 아래 표준 MIME이 HTTP Content-Type에 확실히 적용된다.
  const body = new Uint8Array(await file.arrayBuffer());
  return bucket.upload(objectKey, body, {
    contentType,
    upsert: false,
  });
}
