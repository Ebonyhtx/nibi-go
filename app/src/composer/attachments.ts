// COMPOSE 附件：图片/文件选择与内核 AttachmentRef 转换。
//
// 手机端不做“把内容塞进正文”：附件只作为文件引用交给内核，由内核按 mime 生成
// 图片/PDF/文本内容块。文件留在 App 缓存/相册临时目录，发送时由内核读取。

import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

import type { KernelAttachmentRef } from "@nibi-go/kernel-session";

export interface ComposerAttachment {
  id: string;
  uri: string;
  name: string;
  mime: string;
  bytes: number;
  kind: "image" | "file";
}

function newId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function stripScheme(uri: string): string {
  return uri.replace(/^file:\/\//u, "");
}

function fallbackName(uri: string): string {
  const part = uri.split(/[\\/]/u).filter(Boolean).at(-1);
  return part && part.length > 0 ? decodeURIComponent(part) : "附件";
}

function guessMime(name: string, kind: "image" | "file"): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (kind === "image") {
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    if (ext === "gif") return "image/gif";
    if (ext === "heic") return "image/heic";
    return "image/jpeg";
  }
  if (ext === "pdf") return "application/pdf";
  if (ext === "txt" || ext === "md" || ext === "json" || ext === "csv") {
    return "text/plain";
  }
  if (ext === "html" || ext === "htm") return "text/html";
  return "application/octet-stream";
}

export async function pickImages(): Promise<ComposerAttachment[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: 5,
    quality: 0.9,
  });
  if (result.canceled) return [];
  return result.assets.map((asset) => {
    const name = asset.fileName?.trim() || fallbackName(asset.uri);
    return {
      id: newId(),
      uri: asset.uri,
      name,
      mime: asset.mimeType?.trim() || guessMime(name, "image"),
      bytes: asset.fileSize ?? 0,
      kind: "image",
    };
  });
}

export async function pickFiles(): Promise<ComposerAttachment[]> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];
  return result.assets.map((asset) => {
    const name = asset.name?.trim() || fallbackName(asset.uri);
    return {
      id: newId(),
      uri: asset.uri,
      name,
      mime: asset.mimeType?.trim() || guessMime(name, "file"),
      bytes: asset.size ?? 0,
      kind: "file",
    };
  });
}

export function toAttachmentRef(attachment: ComposerAttachment): KernelAttachmentRef {
  return {
    ref: stripScheme(attachment.uri),
    fileName: attachment.name,
    mime: attachment.mime,
    bytes: attachment.bytes,
  };
}