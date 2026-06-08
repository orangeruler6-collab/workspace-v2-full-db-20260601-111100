"use client";

import { WriterDialogModal } from "./WriterDialogModal";

const guideSections = [
  {
    title: "引用风格",
    body: "这里决定 AI 按谁的写法来写。选账号就是参考单个账号的风格卡和样本文稿；选项目就是参考项目里绑定的多个账号和素材池。"
  },
  {
    title: "写作需求",
    body: "这里写你真正要 AI 完成的任务，比如主题、目标人群、核心观点、口吻要求。下面素材有内容后，这里会出现 @素材1、@素材2，点一下就能引用。"
  },
  {
    title: "输入源",
    body: "这里只负责放材料。每个输入框就是一个独立素材，可以粘贴抖音/B站链接、原文、观点、开头结尾，也可以拖入 Word、TXT 或 Markdown 文档。"
  },
  {
    title: "说明用途",
    body: "素材具体怎么用，统一写在上面的写作需求里。比如「@素材1 做主线，@素材2 做开头，@素材3 只取结尾互动」。"
  },
  {
    title: "@引用",
    body: "只有填写了内容的素材才会显示 @ 按钮。点击 @素材1 会把它插入到写作需求里，方便你继续补一句它要承担的角色。"
  },
  {
    title: "联网检索",
    body: "默认开启。它适合补充最新信息、事实背景和外部资料。如果只想严格基于你给的素材生成，可以手动关闭。"
  },
  {
    title: "生成结果",
    body: "右侧是最终稿件区。生成后可以直接手动删改，不需要每次都让 AI 重写。复制、发布飞书、生成评论都会使用这里当前的内容。"
  },
  {
    title: "局部改写",
    body: "在生成结果里选中一段文字，会出现改写面板。输入「更短」「更口语」「加冲突感」这类要求，就只替换选中的片段。"
  },
  {
    title: "历史记录",
    body: "右侧历史会保存生成过的稿件。点一条历史可以恢复当时的写作要求、素材和结果，方便继续改。"
  }
];

type WriterGuideModalProps = {
  onClose: () => void;
};

export function WriterGuideModal({ onClose }: WriterGuideModalProps) {
  return (
    <WriterDialogModal labelledBy="writer-guide-dialog-title" panelClassName="writer-guide-modal" onClose={onClose}>
      <div className="modal-header">
        <div>
          <h2 id="writer-guide-dialog-title">对话写作新手指引</h2>
          <p className="subtle">按区域理解这个页面，每个地方都是为了让 AI 更明确地接收你的写作意图。</p>
        </div>
        <button className="btn" onClick={onClose} type="button">
          关闭
        </button>
      </div>
      <div className="writer-guide-body">
        {guideSections.map((section, index) => (
          <section className="writer-guide-step" key={section.title}>
            <span>{index + 1}</span>
            <div>
              <h3>{section.title}</h3>
              <p>{section.body}</p>
            </div>
          </section>
        ))}
      </div>
    </WriterDialogModal>
  );
}
