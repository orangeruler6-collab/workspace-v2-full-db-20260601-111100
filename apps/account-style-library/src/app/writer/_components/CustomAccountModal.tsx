"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { isBackdropEvent } from "@/components/dialog-events";
import type { Platform } from "@/lib/types";

type CustomAccountModalProps = {
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: { platform: Platform; name: string; customLinks: string[]; styleText?: string }) => void;
};

export function CustomAccountModal({ busy, onClose, onSubmit }: CustomAccountModalProps) {
  const [platform, setPlatform] = useState<Platform>("douyin");
  const [name, setName] = useState("");
  const [linksText, setLinksText] = useState("");
  const [styleText, setStyleText] = useState("");
  const links = linksText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (isBackdropEvent(event)) onClose();
      }}
    >
      <div aria-labelledby="custom-account-title" aria-modal="true" className="modal-panel custom-account-modal" role="dialog">
        <div className="modal-header">
          <div>
            <h2 id="custom-account-title">自定义账号风格</h2>
            <p className="pane-subtitle">把多条参考链接拼成一个账号风格，不会触发采集。</p>
          </div>
          <button aria-label="关闭" className="btn icon-btn" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        <div className="modal-editor custom-account-form">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="custom-account-platform">平台</label>
              <select id="custom-account-platform" value={platform} onChange={(event) => setPlatform(event.target.value as Platform)}>
                <option value="douyin">抖音</option>
                <option value="bilibili">B站</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="custom-account-name">账号名</label>
              <input id="custom-account-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：逆水寒凿子参考风格" />
            </div>
          </div>

          <div className="field">
            <label htmlFor="custom-account-links">参考链接</label>
            <textarea
              id="custom-account-links"
              rows={7}
              value={linksText}
              onChange={(event) => setLinksText(event.target.value)}
              placeholder="一行一条链接，可粘贴多条抖音/B站/网页链接"
            />
          </div>

          <div className="field">
            <label htmlFor="custom-account-style">补充风格要求</label>
            <textarea
              id="custom-account-style"
              rows={4}
              value={styleText}
              onChange={(event) => setStyleText(event.target.value)}
              placeholder="可选：比如口吻、节奏、禁用词、常用结构"
            />
          </div>

          <div className="button-row">
            <span className="subtle">已识别 {links.length} 条链接</span>
            <button className="btn primary" disabled={busy || !name.trim() || !links.length} onClick={() => onSubmit({ platform, name, customLinks: links, styleText })} type="button">
              <Plus aria-hidden="true" size={16} />
              {busy ? "保存中..." : "保存为账号"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
