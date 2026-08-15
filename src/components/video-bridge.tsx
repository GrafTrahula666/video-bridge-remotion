"use client";

import { uploadPresigned } from "@vercel/blob/client";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { MULTIPART_THRESHOLD_BYTES } from "@/lib/config";
import { getExtension, validateVideoFile } from "@/lib/video";

const ACCESS_KEY_STORAGE = "videobridge-access-key-v1";
const UPLOAD_STORAGE = "videobridge-last-upload-v1";

type MediaMetadata = {
  duration: number | null;
  width: number | null;
  height: number | null;
};

type UploadRecord = {
  version: 1;
  url: string;
  pathname: string;
  originalFilename: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  expiresAt: string;
  deleteToken: string;
  metadata: MediaMetadata;
};

type LinkCheck = {
  directAccess: boolean;
  status: number;
  rangeStatus: number;
  contentType: string;
  contentLength: number | null;
  looksLikeHtml: boolean;
};

type UploadStatus =
  | "idle"
  | "reading"
  | "ready"
  | "authorizing"
  | "uploading"
  | "checking"
  | "success"
  | "cancelled"
  | "error"
  | "deleting";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "Не определена";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function statusLabel(status: UploadStatus): string {
  const labels: Record<UploadStatus, string> = {
    idle: "Ожидание файла",
    reading: "Читаю метаданные…",
    ready: "Готово к загрузке",
    authorizing: "Подготавливаю защищённую загрузку…",
    uploading: "Загрузка напрямую в Vercel Blob…",
    checking: "Проверяю прямую ссылку…",
    success: "Загрузка завершена",
    cancelled: "Загрузка отменена",
    error: "Ошибка загрузки",
    deleting: "Удаляю файл…",
  };
  return labels[status];
}

function formatCountdown(expiresAt: string, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

async function readVideoMetadata(file: File): Promise<MediaMetadata> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const finish = (metadata: MediaMetadata) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      video.load();
      resolve(metadata);
    };

    const timeout = window.setTimeout(
      () => finish({ duration: null, width: null, height: null }),
      10_000,
    );
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      finish({
        duration: Number.isFinite(video.duration) ? video.duration : null,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      });
    };
    video.onerror = () => {
      window.clearTimeout(timeout);
      finish({ duration: null, width: null, height: null });
    };
    video.src = objectUrl;
  });
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

function remotionPrompt(url: string): string {
  return `Используй этот исходный видеофайл:\n${url}\n\nСначала проверь, что URL доступен, скачай файл в рабочую директорию проекта и определи его duration, resolution, fps и codec. Не начинай монтаж, пока не убедишься, что файл действительно скачался и читается.\n\nПосле этого используй его как исходный media asset в Remotion.`;
}

export function VideoBridge() {
  const [hydrated, setHydrated] = useState(false);
  const [accessKey, setAccessKey] = useState("");
  const [accessDraft, setAccessDraft] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<MediaMetadata>({ duration: null, width: null, height: null });
  const [record, setRecord] = useState<UploadRecord | null>(null);
  const [check, setCheck] = useState<LinkCheck | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState({ loaded: 0, total: 0, percentage: 0 });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [zipBusy, setZipBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const expiryDeleteRef = useRef(false);

  useEffect(() => {
    const savedKey = localStorage.getItem(ACCESS_KEY_STORAGE) ?? "";
    const savedRecord = localStorage.getItem(UPLOAD_STORAGE);
    const frame = window.requestAnimationFrame(() => {
      setAccessKey(savedKey);
      setAccessDraft(savedKey);
      if (savedRecord) {
        try {
          const parsed = JSON.parse(savedRecord) as UploadRecord;
          if (parsed.version === 1 && parsed.url) {
            setRecord(parsed);
            setMetadata(parsed.metadata);
            setStatus("success");
            setProgress({ loaded: parsed.size, total: parsed.size, percentage: 100 });
          }
        } catch {
          localStorage.removeItem(UPLOAD_STORAGE);
        }
      }
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const verifyLink = useCallback(async (target: UploadRecord) => {
    setCheck(null);
    setStatus("checking");
    setError("");
    try {
      const result = await readJson<LinkCheck>(
        await fetch("/api/check", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-videobridge-key": accessKey },
          body: JSON.stringify({ url: target.url }),
        }),
      );
      setCheck(result);
      setStatus("success");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось проверить ссылку.");
      setStatus("success");
    }
  }, [accessKey]);

  useEffect(() => {
    if (!hydrated || !record || !accessKey || check) return;
    const timer = window.setTimeout(() => void verifyLink(record), 0);
    return () => window.clearTimeout(timer);
  }, [accessKey, check, hydrated, record, verifyLink]);

  const deleteFile = useCallback(async (automatic = false) => {
    if (!record) return;
    if (!automatic && !window.confirm("Удалить исходное видео без возможности восстановления?")) return;
    setStatus("deleting");
    setError("");
    try {
      await readJson<{ deleted: boolean }>(
        await fetch("/api/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: record.url,
            expiresAt: record.expiresAt,
            deleteToken: record.deleteToken,
          }),
        }),
      );
      localStorage.removeItem(UPLOAD_STORAGE);
      setRecord(null);
      setSelectedFile(null);
      setCheck(null);
      setProgress({ loaded: 0, total: 0, percentage: 0 });
      setStatus("idle");
      setNotice(automatic ? "Срок хранения истёк — файл удалён." : "Файл удалён.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось удалить файл.");
      setStatus("success");
    } finally {
      expiryDeleteRef.current = false;
    }
  }, [record]);

  useEffect(() => {
    if (!record || Date.parse(record.expiresAt) > now || expiryDeleteRef.current) return;
    expiryDeleteRef.current = true;
    void deleteFile(true);
  }, [deleteFile, now, record]);

  const saveAccessKey = (event: FormEvent) => {
    event.preventDefault();
    const value = accessDraft.trim();
    if (!value) return;
    localStorage.setItem(ACCESS_KEY_STORAGE, value);
    setAccessKey(value);
    setNotice("Код сохранён на этом устройстве.");
  };

  const changeAccessKey = () => {
    localStorage.removeItem(ACCESS_KEY_STORAGE);
    setAccessKey("");
    setAccessDraft("");
    setCheck(null);
  };

  const selectFile = async (file: File) => {
    setError("");
    setNotice("");
    setCheck(null);
    try {
      validateVideoFile({ filename: file.name, mimeType: file.type, size: file.size });
      setSelectedFile(file);
      setStatus("reading");
      setProgress({ loaded: 0, total: file.size, percentage: 0 });
      const nextMetadata = await readVideoMetadata(file);
      setMetadata(nextMetadata);
      setStatus("ready");
    } catch (caught) {
      setSelectedFile(null);
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Некорректный файл.");
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void selectFile(file);
  };

  const startUpload = async () => {
    if (!selectedFile || !accessKey) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setNotice("");
    setStatus("authorizing");

    try {
      const authorization = await readJson<{
        pathname: string;
        expiresAt: string;
        deleteToken: string;
        mimeType: string;
      }>(
        await fetch("/api/upload/authorize", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-videobridge-key": accessKey },
          body: JSON.stringify({
            filename: selectedFile.name,
            mimeType: selectedFile.type,
            size: selectedFile.size,
          }),
          signal: controller.signal,
        }),
      );

      setStatus("uploading");
      const blob = await uploadPresigned(authorization.pathname, selectedFile, {
        access: "public",
        handleUploadUrl: "/api/upload",
        headers: { "x-videobridge-key": accessKey },
        clientPayload: JSON.stringify({
          expiresAt: authorization.expiresAt,
          deleteToken: authorization.deleteToken,
        }),
        contentType: authorization.mimeType,
        multipart: selectedFile.size > MULTIPART_THRESHOLD_BYTES,
        abortSignal: controller.signal,
        onUploadProgress: ({ loaded, total, percentage }) => {
          setProgress({ loaded, total, percentage });
        },
      });

      const nextRecord: UploadRecord = {
        version: 1,
        url: blob.url,
        pathname: blob.pathname,
        originalFilename: selectedFile.name,
        mimeType: authorization.mimeType,
        size: selectedFile.size,
        uploadedAt: new Date().toISOString(),
        expiresAt: authorization.expiresAt,
        deleteToken: authorization.deleteToken,
        metadata,
      };
      localStorage.setItem(UPLOAD_STORAGE, JSON.stringify(nextRecord));
      setRecord(nextRecord);
      setProgress({ loaded: selectedFile.size, total: selectedFile.size, percentage: 100 });
      await verifyLink(nextRecord);
    } catch (caught) {
      if (controller.signal.aborted) {
        setStatus("cancelled");
        setError("Загрузка отменена. Можно повторить — исходный файл остаётся на устройстве.");
      } else {
        setStatus("error");
        setError(caught instanceof Error ? caught.message : "Загрузка не удалась.");
      }
    } finally {
      abortRef.current = null;
    }
  };

  const downloadFallbackZip = async () => {
    if (!record) return;
    setZipBusy(true);
    setError("");
    try {
      const { downloadZip } = await import("client-zip");
      const extension = getExtension(record.pathname);
      let source: File | Response;
      if (
        selectedFile &&
        selectedFile.size === record.size &&
        selectedFile.name === record.originalFilename
      ) {
        source = selectedFile;
      } else {
        const response = await fetch(record.url);
        if (!response.ok) throw new Error(`Не удалось скачать исходник: HTTP ${response.status}`);
        source = response;
      }

      const manifest = JSON.stringify(
        {
          originalFilename: record.originalFilename,
          mimeType: record.mimeType,
          size: record.size,
          uploadedAt: record.uploadedAt,
          directVideoUrl: record.url,
          duration: record.metadata.duration,
          width: record.metadata.width,
          height: record.metadata.height,
        },
        null,
        2,
      );
      const readme = `VideoBridge → Remotion\n\nremotion-input/source-video.${extension} — исходный видеофайл, сохранённый byte-for-byte без перекодирования.\nmanifest.json содержит исходное имя, MIME, размер, дату, direct URL и доступные метаданные.\n\nИспользуйте source-video.${extension} как локальный media asset в Remotion. Сначала проверьте metadata, codec и fps.`;
      const zipResponse = downloadZip([
        { name: `remotion-input/source-video.${extension}`, input: source },
        { name: "remotion-input/manifest.json", input: manifest },
        { name: "remotion-input/README.txt", input: readme },
      ]);
      const zipBlob = await zipResponse.blob();
      const href = URL.createObjectURL(zipBlob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = `videobridge-remotion-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
      setNotice("ZIP сформирован из оригинального видео без второй копии в storage.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось создать ZIP.");
    } finally {
      setZipBusy(false);
    }
  };

  const copy = async (value: string, message: string) => {
    try {
      await copyText(value);
      setNotice(message);
    } catch {
      setError("Не удалось скопировать. Нажмите и удерживайте ссылку.");
    }
  };

  const share = async () => {
    if (!record || !navigator.share) return;
    try {
      await navigator.share({ title: "VideoBridge", text: "Исходное видео для Remotion", url: record.url });
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError("Не удалось открыть меню «Поделиться».");
    }
  };

  const resetForAnother = () => {
    localStorage.removeItem(UPLOAD_STORAGE);
    setRecord(null);
    setSelectedFile(null);
    setCheck(null);
    setMetadata({ duration: null, width: null, height: null });
    setProgress({ loaded: 0, total: 0, percentage: 0 });
    setStatus("idle");
    setError("");
    setNotice("Предыдущий файл останется доступен до автоматического удаления.");
    window.setTimeout(() => inputRef.current?.click(), 0);
  };

  const busy = ["reading", "authorizing", "uploading", "checking", "deleting"].includes(status);

  return (
    <main className="app-shell">
      <header className="brand-row">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">VB</div>
          <div className="brand-copy"><strong>VideoBridge</strong><span>video → Remotion</span></div>
        </div>
        {accessKey ? <button className="text-button" type="button" onClick={changeAccessKey}>Сменить код</button> : null}
      </header>

      <section className="hero">
        <p className="eyebrow">Прямой мост</p>
        <h1>Видео готово к монтажу в несколько нажатий</h1>
        <p>Выберите исходник на iPhone или ПК. Он загрузится напрямую в Blob, минуя Serverless Function.</p>
      </section>

      {!hydrated ? null : !accessKey ? (
        <section className="card access-card">
          <h2>Персональный доступ</h2>
          <p>Введите код VideoBridge один раз. Он сохранится только в этом браузере и защищает загрузку от посторонних.</p>
          <form className="access-form" onSubmit={saveAccessKey}>
            <input className="input" type="password" autoComplete="current-password" value={accessDraft} onChange={(event) => setAccessDraft(event.target.value)} placeholder="Код доступа" aria-label="Код доступа" />
            <button className="button" type="submit" disabled={!accessDraft.trim()}>Сохранить</button>
          </form>
        </section>
      ) : (
        <>
          <section className="card upload-card">
            {!selectedFile && !record ? (
              <label className="drop-zone">
                <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={onFileChange} />
                <span>
                  <span className="upload-icon" aria-hidden="true">↑</span>
                  <strong>Загрузить видео</strong>
                  <span>MP4 / MOV / WebM · до 1 ГБ</span>
                </span>
              </label>
            ) : selectedFile ? (
              <div className="file-panel">
                <input ref={inputRef} hidden type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={onFileChange} />
                <div className="file-topline">
                  <div className="file-name"><strong>{selectedFile.name}</strong><span>{formatBytes(selectedFile.size)} · {selectedFile.type}</span></div>
                  <span className="status-copy">{statusLabel(status)}</span>
                </div>
                <div className="progress-shell" role="progressbar" aria-label="Прогресс загрузки" aria-valuenow={Math.round(progress.percentage)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="progress-bar" style={{ width: `${Math.max(0, Math.min(100, progress.percentage))}%` }} />
                </div>
                <div className="progress-row"><span>{formatBytes(progress.loaded)} / {formatBytes(progress.total || selectedFile.size)}</span><strong>{Math.round(progress.percentage)}%</strong></div>
                {!record ? (
                  <div className="inline-actions">
                    <button className="button" type="button" onClick={() => void startUpload()} disabled={busy || status === "reading"}>{status === "error" || status === "cancelled" ? "Повторить загрузку" : "Загрузить"}</button>
                    {status === "uploading" || status === "authorizing" ? <button className="button danger" type="button" onClick={() => abortRef.current?.abort()}>Отменить</button> : null}
                    {!busy ? <button className="button secondary" type="button" onClick={() => inputRef.current?.click()}>Другой файл</button> : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          {record ? (
            <section className="card result-card">
              <div className="success-head"><div className="success-check" aria-hidden="true">✓</div><div><h2>Видео готово для Remotion</h2><p>Оригинал сохранён без перекодирования</p></div></div>
              <dl className="metadata-list">
                <div className="detail-row"><dt>Имя</dt><dd title={record.originalFilename}>{record.originalFilename}</dd></div>
                <div className="detail-row"><dt>Размер</dt><dd>{formatBytes(record.size)}</dd></div>
                <div className="detail-row"><dt>Формат</dt><dd>{getExtension(record.pathname).toUpperCase()} · {record.mimeType}</dd></div>
                <div className="detail-row"><dt>Разрешение</dt><dd>{record.metadata.width && record.metadata.height ? `${record.metadata.width}×${record.metadata.height}` : "Не определено"}</dd></div>
                <div className="detail-row"><dt>Длительность</dt><dd>{formatDuration(record.metadata.duration)}</dd></div>
                <div className="detail-row"><dt>Загружено</dt><dd>{new Date(record.uploadedAt).toLocaleString("ru-RU")}</dd></div>
              </dl>
              <div className="direct-url">{record.url}</div>
              <div className="action-stack">
                <button className="button full" type="button" onClick={() => void copy(record.url, "Прямая ссылка скопирована.")}>Скопировать ссылку для Remotion</button>
                <button className="button secondary" type="button" onClick={() => void downloadFallbackZip()} disabled={zipBusy}>{zipBusy ? "Создаю ZIP…" : "Скачать ZIP для Remotion"}</button>
                <button className="button secondary" type="button" onClick={() => void share()}>Поделиться</button>
                <button className="button danger full" type="button" onClick={() => void deleteFile(false)} disabled={status === "deleting"}>Удалить сейчас</button>
              </div>
              <div className={`verification ${check ? (check.directAccess ? "" : "error") : "warning"}`}>
                <span>{check ? (check.directAccess ? `Direct access: OK · HTTP ${check.status} · ${check.contentType}` : "Direct access: ошибка") : "Direct access: проверяется…"}</span>
                <button type="button" onClick={() => void verifyLink(record)}>Проверить ссылку</button>
              </div>
              <p className="countdown">Файл будет удалён через: {formatCountdown(record.expiresAt, now)}</p>
              <div className="prompt-section">
                <h2>Промпт для Remotion</h2>
                <div className="prompt-box">{remotionPrompt(record.url)}</div>
                <button className="button secondary full" type="button" onClick={() => void copy(remotionPrompt(record.url), "Промпт и ссылка скопированы.")}>Скопировать промпт + ссылку</button>
              </div>
              <div className="inline-actions"><button className="text-button" type="button" onClick={resetForAnother}>Загрузить другое видео</button></div>
            </section>
          ) : null}

          {error ? <div className="error-banner" role="alert">{error}</div> : null}
          {notice ? <p className="fine-print" role="status">{notice}</p> : null}
          <p className="fine-print">Нет каталога файлов · ссылки уникальны · автоматическое удаление через 24 часа</p>
        </>
      )}
    </main>
  );
}
