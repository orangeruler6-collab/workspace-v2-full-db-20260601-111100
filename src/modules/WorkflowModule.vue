<template>
  <div class="wf-module">
    <div class="wf-hdr module-page-header">
      <div class="wf-title module-page-title">
        <span class="module-page-icon module-page-svg-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 7h6a3 3 0 0 1 3 3v7"/><path d="M4 17h6a3 3 0 0 0 3-3V7"/><path d="M17 7h3v3"/><path d="M17 17h3v-3"/></svg>
        </span>
        <div class="module-page-copy">
          <div class="module-page-kicker">文案工作流</div>
          <h2>文案工作流</h2>
        </div>
      </div>
      <div class="wf-hdr-r module-page-actions">
        <button class="btn btn-sm" :class="planMode.open ? 'btn-pri' : 'btn-soft'" @click="togglePlanMode">Plan模式</button>
        <span class="module-page-pill">{{ nodes.length }} 节点</span>
        <span class="module-page-pill">{{ lines.length }} 连线</span>
        <span class="module-page-pill">{{ doneCount }} 完成</span>
        <button class="wf-icon-btn" title="缩小" @click="zoomBy(-1)">-</button>
        <span class="wf-zoom-text">{{ zoomLabel }}</span>
        <button class="wf-icon-btn" title="放大" @click="zoomBy(1)">+</button>
        <button class="btn btn-sm btn-ghost" @click="fitView">适应视图</button>
        <button class="btn btn-sm" @click="reset">重置</button>
      </div>
    </div>

    <div
      ref="canvasRef"
      class="wf-canvas"
      :class="{ panning: dWhat === 'canvas', connecting: dWhat === 'line' }"
      :style="gridStyle"
      @mousedown="onDown"
      @wheel.prevent="onWheel"
      @contextmenu.prevent="onCtx">
      <div class="wf-world" :style="canvasStyle">
        <svg class="wf-svg" :width="WORLD_W" :height="WORLD_H">
            <defs>
              <marker id="wf-arr" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
              <path d="M0,0 L10,4 L0,8 Z" fill="var(--wf-line-c)"/>
              </marker>
              <linearGradient id="wf-line-grad" x1="0%" x2="100%" y1="0%" y2="0%">
              <stop offset="0%" stop-color="var(--wf-line-a)"/>
              <stop offset="52%" stop-color="var(--wf-line-b)"/>
              <stop offset="100%" stop-color="var(--wf-line-c)"/>
              </linearGradient>
            </defs>
          <g
            v-for="l in lines"
            :key="l.id"
            class="wf-line-group">
            <path
              :d="curvePath(l)"
              class="wf-line-hit"
              @mousedown.stop
              @click.stop="rmL(l.id)"/>
            <path
              :d="curvePath(l)"
              class="wf-line"
              marker-end="url(#wf-arr)"/>
          </g>
          <path
            v-if="dl"
            :d="dlPath"
            class="wf-line wf-line-draft"
            :class="{ ok: hoverPort }"/>
        </svg>

        <div
          v-for="n in nodes"
          :key="n.id"
          class="wf-node"
          :class="[n.type, sel === n.id ? 'sel' : '', stKind(n)]"
          :style="{ left: n.x + 'px', top: n.y + 'px' }">
          <div
            v-for="(pt, pi) in inPorts(n)"
            :key="pt.key"
            class="wf-port wf-port-in"
            :class="{ used: pt.used, target: isHoverPort(n, 'in', pi) }"
            :style="{ top: pt.y + 'px' }"
            :title="pt.used ? '输入已连接' : '输入'"
            @mousedown.stop="sL($event, n, 'in', pi)">
            <span class="wf-port-name" aria-hidden="true"></span>
          </div>

          <div class="wf-node-body" @mousedown.stop="dragN($event, n)" @dblclick.stop="runN(n)">
            <div class="wf-nhdr">
              <span class="wf-icon" :title="n.label" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path v-for="(d, i) in iconPaths(n.type)" :key="i" :d="d"></path>
                </svg>
              </span>
              <span class="wf-nn">{{ n.label }}</span>
              <span class="wf-st" :class="stKind(n)" :title="n.data.s || '待运行'"></span>
            </div>
            <div class="wf-nbd">
              <template v-if="n.type === 'input'">
                <div class="wf-source-tabs">
                  <button type="button" :class="{ active: inputSourceType(n) === 'video' }" @click.stop="setInputSourceType(n, 'video')">素材输入</button>
                  <button type="button" :class="{ active: inputSourceType(n) === 'brief' }" @click.stop="setInputSourceType(n, 'brief')">商单 BF</button>
                </div>
                <input v-if="inputSourceType(n) === 'brief'" class="wf-i" v-model="n.data.briefTitle" placeholder="BF 标题 / 项目名"/>
                <input class="wf-i" v-model="n.data.url" placeholder="抖音 / B站 / 飞书链接，可一次输入多个"/>
                <div
                  class="wf-doc-drop"
                  :class="{ dragging: n.data.docDragging, busy: n.data.docParsing }"
                  @dragover.prevent.stop="n.data.docDragging = true"
                  @dragleave.prevent.stop="n.data.docDragging = false"
                  @drop.prevent.stop="handleBriefDocDrop(n, $event)">
                  <span>{{ n.data.docParsing ? '正在解析文档...' : '拖拽 PDF / Word 到这里，或选择文件采集' }}</span>
                  <button class="btn btn-xs btn-soft" type="button" :disabled="n.data.docParsing" @click.stop="openBriefDocPicker(n)">选择文件</button>
                  <input :ref="el => setBriefFileInput(n.id, el)" class="wf-hidden-file" type="file" accept=".pdf,.doc,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword" @change="handleBriefDocSelect(n, $event)" />
                </div>
                <textarea class="wf-i" v-model="n.data.idea" rows="2" placeholder="手动补充 BF / 素材文本 / 创作要求"/>
                <button class="btn btn-xs btn-run" @click.stop="runN(n)">运行</button>
              </template>

              <template v-else-if="n.type === 'transcribe'">
                <div class="wf-s">{{ n.data.s }}</div>
                <textarea v-if="n.data.text" class="wf-i" v-model="n.data.text" rows="2" readonly/>
                <button class="btn btn-xs btn-run" :disabled="n.run" @click.stop="runN(n)">{{ n.run ? '采集中' : '采集' }}</button>
              </template>

              <template v-else-if="n.type === 'analyze'">
                <div class="wf-s">{{ n.data.s }}</div>
                <textarea v-if="n.data.r" class="wf-i" v-model="n.data.r" rows="2" readonly/>
                <button class="btn btn-xs btn-run" :disabled="n.run" @click.stop="runN(n)">{{ n.run ? '运行中' : '运行' }}</button>
              </template>

              <template v-else-if="n.type === 'hot'">
                <div class="wf-s">{{ n.data.s }}</div>
                <div v-if="n.data.rs && n.data.rs.length" class="wf-ri-list">
                  <div v-for="(r, i) in n.data.rs.slice(0, 3)" :key="i" class="wf-ri">{{ r.title || r.text }}</div>
                </div>
                <button class="btn btn-xs btn-run" :disabled="n.run" @click.stop="runN(n)">{{ n.run ? '运行中' : '搜索' }}</button>
              </template>

              <template v-else-if="n.type === 'platform'">
                <div class="wf-s">{{ n.data.s }}</div>
                <div class="wf-platform-candidates">
                  B站：{{ n.data.keywords || '等待关键词' }} · 候选 {{ (n.data.candidates || []).length }}  · 转写 {{ (n.data.selected || []).length }}/3
                </div>
                <div v-if="n.data.candidates && n.data.candidates.length" class="wf-ri-list">
                  <div v-for="(r, i) in n.data.candidates.slice(0, 3)" :key="i" class="wf-ri">
                    {{ r.selected ? '已选' : '候选' }} · B站 {{ r.title || r.text }}
                  </div>
                </div>
                <button class="btn btn-xs btn-run" :disabled="n.run" @click.stop="runN(n)">
                  {{ n.run ? '搜索中' : '搜索B站' }}
                </button>
              </template>

              <template v-else-if="n.type === 'vec'">
                <div class="wf-s">{{ n.data.s }}</div>
                <div v-if="n.data.rs && n.data.rs.length" class="wf-ri-list">
                  <div v-for="(r, i) in n.data.rs.slice(0, 3)" :key="i" class="wf-ri">{{ (r.text || r.content || r.summary || '').substring(0, 40) }}</div>
                </div>
                <button class="btn btn-xs btn-run" :disabled="n.run" @click.stop="runN(n)">{{ n.run ? '运行中' : '搜索' }}</button>
              </template>

              <template v-else-if="n.type === 'sum'">
                <div class="wf-s">{{ n.data.s }}</div>
                <textarea v-if="n.data.txt" class="wf-i wf-preview" v-model="n.data.txt" rows="3" readonly @dblclick.stop="openOutput(n)"/>
                <button v-if="n.data.txt" class="btn btn-xs btn-soft" @click.stop="openOutput(n)">查看全文</button>
                <button class="btn btn-xs btn-run" :disabled="n.run" @click.stop="runN(n)">{{ n.run ? '生成中' : '生成报告' }}</button>
                <button v-if="n.data.txt" class="btn btn-xs btn-feishu" @click.stop="saveFeishu(n)">写入飞书</button>
              </template>

              <template v-else-if="n.type === 'idea'">
                <div class="wf-s">{{ n.data.s }}</div>
                <div v-if="false && n.data.list && n.data.list.length" class="wf-ideas">
                  <div
                    v-for="(idea, i) in n.data.list"
                    :key="i"
                    class="wf-icard"
                    :class="{ picked: n.data.sel === i }">
                    <span class="wf-in">{{ i + 1 }}</span>
                    <span class="wf-it">{{ idea }}</span>
                    <button class="btn btn-xs btn-gst" @click.stop="pickI(n, i)">选择</button>
                  </div>
                </div>
                <button class="btn btn-xs btn-run" :disabled="n.run" @click.stop="runN(n)">{{ n.run ? '生成中' : '炸创意' }}</button>
              </template>

              <template v-else-if="n.type === 'ideaCard'">
                <div class="wf-s">{{ n.data.s }}</div>
                <div class="wf-idea-card-title">
                  <span>方案 {{ ideaCardOrder(n) }}</span>
                  <b>{{ n.data.title || '创意方向' }}</b>
                </div>
                <div class="wf-idea-card-points">
                  <div class="wf-idea-card-meta" v-if="n.data.entry"><b>切入</b><span>{{ n.data.entry }}</span></div>
                  <div class="wf-idea-card-meta" v-if="n.data.framework"><b>框架</b><span>{{ n.data.framework }}</span></div>
                  <div class="wf-idea-card-meta" v-if="n.data.ending"><b>结尾</b><span>{{ n.data.ending }}</span></div>
                </div>
                <div class="wf-idea-style-line" :class="{ empty: !n.data.styleRef, chosen: !!n.data.styleRef }">
                  <div class="wf-idea-style-copy">
                    <b>风格卡</b>
                    <span>{{ n.data.styleRef?.name || '还没选风格，建议先确认再生成' }}</span>
                  </div>
                  <button class="btn btn-xs" :class="n.data.styleRef ? 'btn-soft' : 'btn-pri'" @click.stop="selectNode(n)">选风格</button>
                </div>
                <button class="btn btn-xs btn-run" :disabled="n.run" @click.stop="pickI(n)">{{ n.run ? '生成中' : '用这个生成' }}</button>
              </template>

              <template v-else-if="n.type === 'gen'">
                <div class="wf-s">{{ n.data.s }}</div>
                <div class="wf-btns">
                  <button class="btn btn-xs" :class="n.data.mdl === 'GPT-5.5' ? 'btn-pri' : 'btn-soft'" @click.stop="n.data.mdl = 'GPT-5.5'">GPT-5.5</button>
                  <button class="btn btn-xs" :class="n.data.mdl === 'Kimi' ? 'btn-pri' : 'btn-soft'" @click.stop="n.data.mdl = 'Kimi'">Kimi</button>
                </div>
                <div class="wf-word-slider" @mousedown.stop>
                  <div class="wf-word-slider-head">
                    <span>字数</span>
                    <b>{{ wordTargetLabel(n.data.words) }}</b>
                    <input class="wf-word-input" type="number" :min="WORD_MIN" :max="WORD_MAX" :step="WORD_STEP" :value="wordTargetValue(n)" @change.stop="setWordTarget(n, $event.target.value)" @keydown.enter.stop="setWordTarget(n, $event.target.value)" />
                  </div>
                  <div class="wf-word-slider-track">
                    <input
                      type="range"
                      :min="WORD_SLIDER_MIN"
                      :max="WORD_SLIDER_MAX"
                      :step="WORD_SLIDER_STEP"
                      :value="wordSliderValue(n)"
                      @input.stop="setWordFromSlider(n, $event.target.value)" />
                  </div>
                  <div class="wf-word-slider-scale">
                    <span>{{ WORD_MIN }}</span>
                    <span>常用 {{ WORD_COMMON_MIN }}-{{ WORD_COMMON_MAX }}</span>
                    <span>{{ WORD_MAX }}</span>
                  </div>
                </div>
                <textarea v-if="n.data.out" class="wf-i wf-preview" v-model="n.data.out" rows="3" readonly @dblclick.stop="openOutput(n)"/>
                <button v-if="n.data.out" class="btn btn-xs btn-soft" @click.stop="openOutput(n)">查看全文</button>
                <button class="btn btn-xs btn-run" :disabled="n.run" @click.stop="runGenAction(n)">{{ genRunLabel(n) }}</button>
                <button v-if="n.data.out" class="btn btn-xs btn-feishu" @click.stop="saveFeishu(n)">写入飞书</button>
              </template>            </div>
          </div>

          <div
            class="wf-port wf-port-out"
            :class="{ target: isHoverPort(n, 'out', 0) }"
            :style="{ top: OUT_PORT_Y + 'px' }"
            title="输出"
            @mousedown.stop="sL($event, n, 'out', 0)">
            <span class="wf-port-name wf-port-name-out">出</span>
          </div>
          <button class="wf-nx" title="删除节点" @click.stop="rmN(n.id)">x</button>
          <div class="wf-type-tag">{{ typeCode(n.type) }}</div>
        </div>
      </div>

      <div class="wf-palette" @mousedown.stop @wheel.stop>
        <button
          v-for="t in TYPES"
          :key="t.type"
          class="wf-palette-btn"
          :title="t.l"
          @click="addNodeFromPalette(t.type)">
          <svg class="wf-palette-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path v-for="(d, i) in iconPaths(t.type)" :key="i" :d="d"></path>
          </svg>
        </button>
      </div>

      <div class="wf-zoom" @mousedown.stop @wheel.stop>
        <button class="wf-icon-btn" title="缩小" @click="zoomBy(-1)">-</button>
        <span>{{ zoomLabel }}</span>
        <button class="wf-icon-btn" title="放大" @click="zoomBy(1)">+</button>
      </div>

      <div v-if="ctx.show" class="wf-ctx" :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }" @mousedown.stop>
        <div class="ctx-hit danger" @click="ctxDo('del')" v-if="ctx.nid">删除节点</div>
        <div class="ctx-hit" @click="ctxDo('dup')" v-if="ctx.nid">复制节点</div>
        <div class="ctx-div" v-if="ctx.nid"></div>
        <div class="ctx-lbl">插入节点</div>
        <div v-for="t in TYPES" :key="t.type" class="ctx-hit ctx-hit-icon" @click="ctxDo('add', t.type)">
          <svg class="wf-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path v-for="(d, i) in iconPaths(t.type)" :key="i" :d="d"></path>
          </svg>
          <span>{{ t.l }}</span>
        </div>
      </div>
    </div>
    <aside v-if="planMode.open" class="wf-plan" @mousedown.stop @wheel.stop>
      <header class="wf-plan-head">
        <div>
          <span>PLAN ASSIST</span>
          <h3>方案辅助板块</h3>
          <small>{{ planMode.contextStatus || '读取当前工作流输入源 / BF / 已采集内容' }}</small>
        </div>
        <button class="wf-icon-btn" title="close" @click="planMode.open = false">x</button>
      </header>
      <section class="wf-plan-card">
        <span class="wf-plan-kicker">像 Codex 一样先聊方案</span>
        <h4>问问题，AI 给选项，再继续推进</h4>
        <p>适合先讨论选题、角度、结构、风险和执行路径。确认后的方案可以写回创意节点。</p>
        <button class="btn btn-sm btn-soft" :disabled="planMode.collecting || planMode.busy" @click="collectPlanSources">
          {{ planMode.collecting ? '转写/读取中' : '读取/转写输入源' }}
        </button>
      </section>
      <section class="wf-plan-chat">
        <div v-if="!planMode.messages.length" class="wf-plan-empty">
          <b>可以这样问</b>
          <button type="button" @click="askPlanQuick('这个选题应该从哪个角度切？给我几个方案选。')">这个选题从哪个角度切？</button>
          <button type="button" @click="askPlanQuick('先帮我判断这个方案风险在哪里，有没有更稳的结构。')">这个方案风险在哪里？</button>
          <button type="button" @click="askPlanQuick('不要写成稿，先给我三种可选的内容结构。')">给我三种结构选项</button>
        </div>
        <article
          v-for="(msg, i) in planMode.messages"
          :key="i"
          class="wf-plan-msg"
          :class="msg.role">
          <div class="wf-plan-msg-role">{{ msg.role === 'user' ? '你' : 'AI' }}</div>
          <p>{{ msg.content }}</p>
          <div v-if="msg.options && msg.options.length" class="wf-plan-options">
            <button
              v-for="(option, oi) in msg.options"
              :key="oi"
              type="button"
              :disabled="planMode.busy"
              @click="choosePlanOption(option)">
              {{ option }}
            </button>
          </div>
        </article>
      </section>
      <label class="wf-field">
        <span>你的问题</span>
        <textarea
          class="wf-plan-input"
          v-model="planMode.question"
          rows="3"
          @keydown.enter.exact.prevent="runPlanAsk"
          @keydown.ctrl.enter.prevent="runPlanAsk"
          placeholder="比如：这条内容要怎么做更有爆点？给我 3 个方向选。"></textarea>
      </label>
      <section class="wf-plan-output">
        <div class="wf-plan-output-head">
          <span>已确认方案</span>
          <small>{{ planMode.confirmed ? '可写入' : '可手动整理' }}</small>
        </div>
        <textarea class="wf-plan-draft" v-model="planMode.draft" placeholder="点选 AI 给出的方案后，会沉淀到这里；也可以手动整理成最终方案。"></textarea>
      </section>
      <footer class="wf-plan-actions">
        <button class="btn btn-sm btn-soft" @click="resetPlanAssist">清空讨论</button>
        <button class="btn btn-sm btn-pri" :disabled="planMode.busy || !planMode.question.trim()" @click="runPlanAsk">
          {{ planMode.busy ? '思考中' : '发送问题' }}
        </button>
        <button class="btn btn-sm btn-run" :disabled="!planMode.draft.trim()" @click="applyPlanToIdea">写入创意节点</button>
      </footer>
    </aside>
    <aside v-if="selectedNode" class="wf-side" @mousedown.stop @wheel.stop>
      <header class="wf-side-head">
        <div>
          <span class="wf-side-kicker">{{ typeCode(selectedNode.type) }}</span>
          <h3>{{ selectedNode.label }}</h3>
        </div>
        <button class="wf-icon-btn" title="关闭" @click="closeDetail">x</button>
      </header>
      <div class="wf-side-status">
        <span class="wf-st" :class="stKind(selectedNode)"></span>
        <span>{{ selectedNode.data.s || '就绪' }}</span>
      </div>
      <div class="wf-side-content">
        <template v-if="selectedNode.type === 'input'">
          <label class="wf-field">
            <span>输入类型</span>
            <div class="wf-side-segment">
              <button
                class="btn btn-sm"
                :class="inputSourceType(selectedNode) === 'video' ? 'btn-pri' : 'btn-soft'"
                @click="setInputSourceType(selectedNode, 'video')">
                素材输入
              </button>
              <button
                class="btn btn-sm"
                :class="inputSourceType(selectedNode) === 'brief' ? 'btn-pri' : 'btn-soft'"
                @click="setInputSourceType(selectedNode, 'brief')">
                商单 BF
              </button>
            </div>
          </label>
          <label v-if="inputSourceType(selectedNode) === 'brief'" class="wf-field">
            <span>BF 标题</span>
            <input class="wf-i" v-model="selectedNode.data.briefTitle" placeholder="项目名 / 品牌名 / 商单标题"/>
          </label>
          <label class="wf-field">
            <span>URL</span>
            <input class="wf-i" v-model="selectedNode.data.url" placeholder="抖音 / B站 / 飞书链接，可一次输入多个"/>
          </label>
          <section
            class="wf-side-doc-drop"
            :class="{ dragging: selectedNode.data.docDragging, busy: selectedNode.data.docParsing }"
            @dragover.prevent="selectedNode.data.docDragging = true"
            @dragleave.prevent="selectedNode.data.docDragging = false"
            @drop.prevent="handleBriefDocDrop(selectedNode, $event)">
            <strong>{{ selectedNode.data.docParsing ? '正在解析文档...' : '拖拽导入 PDF / Word' }}</strong>
            <span>解析后会进入信息采集，可用于普通素材或商单 BF。</span>
            <button class="btn btn-sm btn-soft" type="button" :disabled="selectedNode.data.docParsing" @click="openBriefDocPicker(selectedNode)">选择文件</button>
          </section>
          <label class="wf-field">
            <span>补充文本</span>
            <textarea class="wf-side-text" v-model="selectedNode.data.idea"></textarea>
          </label>
        </template>
        <template v-else-if="selectedNode.type === 'idea'">
          <label class="wf-field">
            <span>字数</span>
            <div class="wf-word-slider" @mousedown.stop>
              <div class="wf-word-slider-head">
                <span>当前目标</span>
                <b>{{ wordTargetLabel(selectedNode.data.words) }}</b>
                <input class="wf-word-input" type="number" :min="WORD_MIN" :max="WORD_MAX" :step="WORD_STEP" :value="wordTargetValue(selectedNode)" @change.stop="setWordTarget(selectedNode, $event.target.value)" @keydown.enter.stop="setWordTarget(selectedNode, $event.target.value)" />
              </div>
              <div class="wf-word-slider-track">
                <input
                  type="range"
                  :min="WORD_SLIDER_MIN"
                  :max="WORD_SLIDER_MAX"
                  :step="WORD_SLIDER_STEP"
                  :value="wordSliderValue(selectedNode)"
                  @input="setWordFromSlider(selectedNode, $event.target.value)" />
              </div>
              <div class="wf-word-slider-scale">
                <span>{{ WORD_MIN }}</span>
                <span>常用 {{ WORD_COMMON_MIN }}-{{ WORD_COMMON_MAX }}</span>
                <span>{{ WORD_MAX }}</span>
              </div>
            </div>
          </label>
          <div class="wf-side-list" v-if="selectedNode.data.list && selectedNode.data.list.length">
            <button
              v-for="(idea, i) in selectedNode.data.list"
              :key="i"
              class="wf-side-idea"
              :class="{ picked: selectedNode.data.sel === i }"
              @click="pickI(selectedNode, i)">
              <span>{{ i + 1 }}</span>
              <b>{{ selectedNode.data.sel === i ? '已选' : '选择' }}</b>
              <em>{{ idea }}</em>
            </button>
          </div>
          <textarea class="wf-side-text" v-model="detailContent"></textarea>
        </template>
        <template v-else-if="selectedNode.type === 'platform'">
          <label class="wf-field">
            <span>平台</span>
            <input class="wf-side-input" value="B站" readonly />
          </label>
          <label class="wf-field">
            <span>关键词</span>
            <input class="wf-side-input" v-model="selectedNode.data.keywords" placeholder="可手动调整，比如 三角洲 V10 角色" />
          </label>
          <div class="wf-platform-actions">
            <button class="btn btn-sm btn-soft" :disabled="selectedNode.run" @click="runN(selectedNode)">重新搜索</button>
            <button class="btn btn-sm btn-run" :disabled="selectedNode.run || !selectedPlatformCount(selectedNode)" @click="transcribeSelectedPlatformCandidates(selectedNode)">
              {{ selectedNode.run ? '处理中' : '转写已选 ' + selectedPlatformCount(selectedNode) }}
            </button>
          </div>
          <div v-if="selectedNode.data.candidates && selectedNode.data.candidates.length" class="wf-platform-candidates">
            <div
              v-for="(item, i) in selectedNode.data.candidates"
              :key="i"
              class="wf-platform-candidate"
              :class="{ selected: item.selected, done: item.transcript_status === 'completed', running: item.transcript_status === 'running', error: item.transcript_status === 'error' }"
              @click="togglePlatformCandidate(selectedNode, item)">
              <b>{{ item.selected ? '已选' : '候选' }}</b>
              <span>B站 · {{ item.title || item.text }}</span>
              <em>
                相关性 {{ item.relevance ?? '-' }} · 数据 {{ item.metrics || item.score || '-' }}
              </em>
              <em v-if="item.transcript_status">{{ platformCandidateStatus(item) }}</em>
              <em v-if="item.transcript">{{ compactLine(item.transcript, 90) }}</em>
              <em v-else-if="item.transcript_error">{{ item.transcript_error }}</em>
            </div>
          </div>
          <textarea class="wf-side-text" v-model="detailContent" readonly></textarea>
        </template>
        <template v-else-if="selectedNode.type === 'hot'">
          <label class="wf-field">
            <span>搜索词</span>
            <input class="wf-side-input" v-model="selectedNode.data.query" placeholder="自动提取；也可手动改，比如 CPTV10 战队 选手" />
          </label>
          <textarea class="wf-side-text" v-model="detailContent" readonly></textarea>
        </template>
        <template v-else-if="selectedNode.type === 'vec'">
          <label class="wf-field">
            <span>表达参考检索词（可选）</span>
            <input class="wf-side-input" v-model="selectedNode.data.query" placeholder="留空自动拆题，多组用 / 分隔" />
          </label>
          <textarea class="wf-side-text" v-model="detailContent" readonly></textarea>
        </template>
        <template v-else-if="selectedNode.type === 'ideaCard'">
          <div class="wf-side-callout">
            <b>先定创意，再挂风格</b>
            <span>切入点、框架和结尾先对齐，风格只做语气加成。</span>
          </div>
          <label class="wf-field">
            <span>字数</span>
            <div class="wf-word-slider" @mousedown.stop>
              <div class="wf-word-slider-head">
                <span>当前目标</span>
                <b>{{ wordTargetLabel(selectedNode.data.words) }}</b>
                <input class="wf-word-input" type="number" :min="WORD_MIN" :max="WORD_MAX" :step="WORD_STEP" :value="wordTargetValue(selectedNode)" @change.stop="setWordTarget(selectedNode, $event.target.value)" @keydown.enter.stop="setWordTarget(selectedNode, $event.target.value)" />
              </div>
              <div class="wf-word-slider-track">
                <input
                  type="range"
                  :min="WORD_SLIDER_MIN"
                  :max="WORD_SLIDER_MAX"
                  :step="WORD_SLIDER_STEP"
                  :value="wordSliderValue(selectedNode)"
                  @input="setWordFromSlider(selectedNode, $event.target.value)" />
              </div>
              <div class="wf-word-slider-scale">
                <span>{{ WORD_MIN }}</span>
                <span>常用 {{ WORD_COMMON_MIN }}-{{ WORD_COMMON_MAX }}</span>
                <span>{{ WORD_MAX }}</span>
              </div>
            </div>
          </label>
          <section class="wf-style-picker">
            <div class="wf-style-picker-head">
              <span>风格卡（可选）</span>
              <button class="btn btn-sm btn-soft" :disabled="styleLoading" @click="loadStyles(true)">
                {{ styleLoading ? '读取中' : '刷新' }}
              </button>
            </div>
            <div class="wf-style-hero" :class="{ chosen: !!activeWorkflowStyle, empty: !activeWorkflowStyle }">
              <div class="wf-style-hero-copy">
                <strong>{{ activeWorkflowStyle ? '已挂风格卡' : '风格卡未选' }}</strong>
                <p>{{ activeWorkflowStyle ? (selectedNode.data.styleReason || activeWorkflowStyle.preview || makeStylePreview(activeWorkflowStyle.style)) : '先把创意卡定准，风格卡按需补上。' }}</p>
              </div>
              <span class="wf-style-hero-badge">{{ activeWorkflowStyle ? '已挂载' : '可选' }}</span>
            </div>
            <div v-if="quickStyleChoices(selectedNode).length" class="wf-style-quick">
              <button
                class="wf-style-chip"
                :class="{ active: !activeWorkflowStyle && selectedNode.data.styleSkipped !== false }"
                @click="selectIdeaCardStyleById(selectedNode, '__none')">
                不使用风格
              </button>
              <button
                v-for="style in quickStyleChoices(selectedNode)"
                :key="style.id"
                class="wf-style-chip"
                :class="{ active: activeWorkflowStyle?.id === style.id }"
                @click="selectIdeaCardStyle(selectedNode, style)">
                {{ style.name }}
              </button>
            </div>
            <label class="wf-style-select-wrap">
              <span class="wf-style-select-label">从完整列表里选</span>
              <select class="wf-side-input wf-style-select" :value="selectedNode.data.styleRef?.id || '__none'" @change="selectIdeaCardStyleById(selectedNode, $event.target.value)">
                <option value="__none">不使用风格（默认）</option>
                <option v-for="style in ideaCardStyleOptions(selectedNode)" :key="style.id" :value="style.id">
                  {{ style.name }} · {{ formatStylePlatform(style.platform) }}
                </option>
              </select>
            </label>
            <div v-if="activeWorkflowStyle" class="wf-style-current wf-style-current-compact">
              <b>{{ activeWorkflowStyle.name }}</b>
              <p>{{ selectedNode.data.styleReason || activeWorkflowStyle.preview || makeStylePreview(activeWorkflowStyle.style) }}</p>
            </div>
          </section>
          <textarea class="wf-side-text" v-model="detailContent"></textarea>
        </template>
        <template v-else-if="selectedNode.type === 'gen'">
          <label class="wf-field">
            <span>字数</span>
            <div class="wf-word-slider" @mousedown.stop>
              <div class="wf-word-slider-head">
                <span>当前目标</span>
                <b>{{ wordTargetLabel(selectedNode.data.words) }}</b>
                <input class="wf-word-input" type="number" :min="WORD_MIN" :max="WORD_MAX" :step="WORD_STEP" :value="wordTargetValue(selectedNode)" @change.stop="setWordTarget(selectedNode, $event.target.value)" @keydown.enter.stop="setWordTarget(selectedNode, $event.target.value)" />
              </div>
              <div class="wf-word-slider-track">
                <input
                  type="range"
                  :min="WORD_SLIDER_MIN"
                  :max="WORD_SLIDER_MAX"
                  :step="WORD_SLIDER_STEP"
                  :value="wordSliderValue(selectedNode)"
                  @input="setWordFromSlider(selectedNode, $event.target.value)" />
              </div>
              <div class="wf-word-slider-scale">
                <span>{{ WORD_MIN }}</span>
                <span>常用 {{ WORD_COMMON_MIN }}-{{ WORD_COMMON_MAX }}</span>
                <span>{{ WORD_MAX }}</span>
              </div>
            </div>
          </label>
          <textarea class="wf-side-text" v-model="detailContent"></textarea>
        </template>
        <template v-else>
          <textarea class="wf-side-text" v-model="detailContent"></textarea>
        </template>
        <section v-if="selectedComments.length" class="wf-comments">
          <div class="wf-comments-head">
            <span>批注</span>
            <small>{{ selectedComments.length }} 条</small>
          </div>
          <article v-for="comment in selectedComments" :key="comment.id" class="wf-comment-card">
            <blockquote>{{ comment.quote }}</blockquote>
            <p>{{ comment.note }}</p>
            <button class="wf-comment-remove" @click="removeComment(comment.id)">删除</button>
          </article>
        </section>
      </div>
      <footer class="wf-side-actions">
        <input class="wf-side-note" v-model="interventionNote" placeholder="选中文本后右键，输入批注要求，AI 只改选中段落"/>
        <button class="btn btn-sm btn-soft" :disabled="interventionBusy || !detailSelectionState.text" @click="openAiAnnotatorFromButton">AI批注</button>
        <button class="btn btn-sm btn-soft" @click="copyDetail">复制</button>
        <button class="btn btn-sm btn-feishu" @click="saveFeishu(selectedNode)">写入飞书</button>
        <button class="btn btn-sm btn-soft" @click="saveDetailToVector">存入向量库</button>
        <button class="btn btn-sm btn-run" :disabled="selectedNode.run" @click="runCurrentNode(selectedNode)">
          {{ selectedNode.run ? '运行中' : '运行当前模块' }}
        </button>
      </footer>
    </aside>
    <div
      v-if="aiAnnotator.show"
      class="wf-ai-pop"
      :style="{ left: aiAnnotator.x + 'px', top: aiAnnotator.y + 'px' }"
      @mousedown.stop
      @contextmenu.prevent.stop>
      <div class="wf-ai-pop-head">
        <span>AI批注改写</span>
        <button class="wf-comment-remove" @click="closeAiAnnotator">关闭</button>
      </div>
      <blockquote>{{ aiAnnotator.quote }}</blockquote>
      <textarea
        class="wf-ai-pop-input"
        v-model="interventionNote"
        rows="3"
        placeholder="告诉 AI 怎么改这段，比如：更口语、更犀利、压缩到两句话、加强悬念"></textarea>
      <div class="wf-ai-pop-actions">
        <button class="btn btn-sm btn-soft" @click="closeAiAnnotator">取消</button>
        <button class="btn btn-sm btn-pri" :disabled="interventionBusy" @click="applyAiAnnotation">
          {{ interventionBusy ? '处理中' : '替换选中段' }}
        </button>
      </div>
    </div>
    <div v-if="outputViewer.show" class="wf-output-backdrop" @mousedown.self="closeOutput">
      <section class="wf-output-panel" @mousedown.stop>
        <header>
          <div>
            <span>{{ outputViewer.kicker }}</span>
            <h3>{{ outputViewer.title }}</h3>
          </div>
          <button class="wf-icon-btn" @click="closeOutput">x</button>
        </header>
        <textarea class="wf-output-text" v-model="outputViewer.text" readonly></textarea>
        <footer>
          <button class="btn btn-sm btn-soft" @click="copyOutput">复制</button>
          <button class="btn btn-sm btn-soft" @click="saveDetailToVector">存入向量库</button>
          <button class="btn btn-sm btn-pri" @click="closeOutput">完成</button>
        </footer>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import {
  chatMinimax,
  extractSearchIntent,
  parseWorkflowDocument,
  readFeishu,
  searchHot,
  searchPlatform,
  searchVector,
  transcribeVideo,
  writeFeishu,
  listWorkflowStyles
} from '../api/tools'
import { addVectorItem } from '../api/vector'
import { cleanTranscriptText } from './tools/textCleanup'

const TYPES = [
  { type: 'input',      l: '输入源',      i: '入', c: '输入' },
  { type: 'transcribe', l: '信息采集',    i: '采', c: '采集' },
  { type: 'analyze',    l: '拆解分析',    i: '析', c: '分析' },
  { type: 'hot',        l: '背景搜索',    i: '搜', c: '背景' },
  { type: 'platform',   l: 'B站视频转写', i: '站', c: 'B站' },
  { type: 'vec',        l: '向量搜索',    i: '向', c: '向量' },
  { type: 'sum',        l: '汇总报告',    i: '汇', c: '汇总' },
  { type: 'idea',       l: '炸创意',      i: '创', c: '创意' },
  { type: 'gen',        l: '生成文案',    i: '文', c: '文案' },
]

const NODE_W = 268
const NODE_H = 168
const OUT_PORT_Y = 88
const WORLD_W = 3200
const WORLD_H = 1800
const GRID = 24
const MIN_ZOOM = 0.38
const MAX_ZOOM = 1.8
const PORT_SNAP = 30
const DEFAULT_WORDS = 450
const WORD_MIN = 100
const WORD_MAX = 6000
const WORD_COMMON_MIN = 200
const WORD_COMMON_MAX = 800
const WORD_STEP = 50
const WORD_SLIDER_MIN = WORD_MIN
const WORD_SLIDER_MAX = WORD_MAX
const WORD_SLIDER_STEP = WORD_STEP
const WORD_COMMON_START = 80
const WORD_COMMON_END = 720

const ICON_PATHS = {
  input: ['M5 5h14v14H5z', 'M8 9h8', 'M8 13h5'],
  transcribe: ['M8 4h8v7a4 4 0 0 1-8 0z', 'M12 15v4', 'M9 20h6'],
  analyze: ['M4 19l6-6 4 4 6-9', 'M15 8h5v5'],
  hot: ['M5 12a7 7 0 1 0 14 0', 'M12 5v7l4 2'],
  platform: ['M6 5l12 7-12 7z', 'M6 5v14'],
  vec: ['M6 7a2 2 0 1 0 0 .1', 'M18 7a2 2 0 1 0 0 .1', 'M12 17a2 2 0 1 0 0 .1', 'M7.5 8.5l3 6', 'M16.5 8.5l-3 6', 'M8 7h8'],
  sum: ['M6 4h12v16H6z', 'M9 8h6', 'M9 12h6', 'M9 16h4'],
  idea: ['M9 18h6', 'M10 21h4', 'M8 11a4 4 0 1 1 8 0c0 2-2 3-2 5h-4c0-2-2-3-2-5z'],
  gen: ['M5 5h14v14H5z', 'M8 9h8', 'M8 13h8', 'M8 17h5']
}

function iconPaths(t) {
  return ICON_PATHS[t] || ICON_PATHS.input
}

function normalizeWordTarget(value) {
  const num = Number(String(value || '').replace(/[^\d]/g, ''))
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_WORDS
  return Math.max(WORD_MIN, Math.min(num, WORD_MAX))
}

function wordTargetLabel(value) {
  return `${normalizeWordTarget(value)}字`
}

function wordTargetValue(n) {
  return normalizeWordTarget(n?.data?.words || DEFAULT_WORDS)
}

function snapWordTarget(value) {
  const normalized = normalizeWordTarget(value)
  return Math.round(normalized / WORD_STEP) * WORD_STEP
}

function mapRange(value, inMin, inMax, outMin, outMax) {
  const ratio = (Number(value) - inMin) / (inMax - inMin)
  return outMin + Math.max(0, Math.min(1, ratio)) * (outMax - outMin)
}

function wordToSlider(value) {
  return snapWordTarget(value)
}

function sliderToWord(value) {
  return snapWordTarget(value)
}

function wordSliderValue(n) {
  return wordToSlider(wordTargetValue(n))
}

function setWordTarget(n, value) {
  if (!n?.data) return
  n.data.words = String(snapWordTarget(value))
}

function setWordFromSlider(n, value) {
  if (!n?.data) return
  n.data.words = String(sliderToWord(value))
}

function copyModelOptions(words, phase = 'draft') {
  const target = normalizeWordTarget(words)
  const maxTokens = Math.min(12000, Math.max(2600, Math.ceil(target * 1.9) + 900))
  const baseTimeout = phase === 'selfcheck' ? 150000 : 180000
  const timeoutMs = Math.min(420000, Math.max(baseTimeout, 90000 + target * 55))
  return {
    max_tokens: maxTokens,
    timeoutMs
  }
}

function normalizeWorkflowUrl(url) {
  let value = repairWorkflowUrlText(url).trim()
  value = value.replace(/[)\]}>'"`.,!?;:\u3002\uff0c\uff01\uff1f\uff1b\uff1a\uff09\u3011\u300b\u3001]+$/g, '')
  if (/^BV[\w]{10}$/i.test(value)) return `https://www.bilibili.com/video/${value}`
  if (value && !/^https?:\/\//i.test(value)) value = 'https://' + value
  return value
}

function extractWorkflowUrl(text) {
  return extractWorkflowUrls(text)[0] || ''
}

function repairWorkflowUrlText(text) {
  return String(text || '')
    .replace(/\bh\s*t\s*p\s*s?\s*:\s*\/\s*\//gi, 'https://')
    .replace(/h\s*t\s*t\s*p\s*s?\s*:\s*\/\s*\//gi, match => match.toLowerCase().includes('https') ? 'https://' : 'http://')
    .replace(/https?:\s*\/\s*\//gi, match => match.toLowerCase().startsWith('https') ? 'https://' : 'http://')
    .replace(/\b([a-z0-9-]{3,})\s+(?=(?:feishu|larksuite)\s*[.\s]*(?:cn|com)\b)/gi, '$1.')
    .replace(/\b(feishu|larksuite)\s*[.\s]+\s*(cn|com)\b/gi, '$1.$2')
    .replace(/\s+(?=\/(?:docx|wiki|docs|doc)\b)/gi, '')
    .replace(/\/\s+(?=[A-Za-z0-9_-]{8,})/g, '/')
}

function extractWorkflowUrls(text) {
  const raw = repairWorkflowUrlText(text)
  const patterns = [
    /(?:https?:\/\/)?v\.douyin\.com\/[^\s"'<>\u4e00-\u9fa5]+/gi,
    /(?:https?:\/\/)?(?:www\.)?douyin\.com\/video\/\d+[^\s"'<>\u4e00-\u9fa5]*/gi,
    /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/BV[\w]+[^\s"'<>\u4e00-\u9fa5]*/gi,
    /(?:https?:\/\/)?b23\.tv\/[^\s"'<>\u4e00-\u9fa5]+/gi,
    /(?:https?:\/\/)?(?:[^/\s"'<>\u4e00-\u9fa5]+\.)?(?:feishu|larksuite)\.(?:cn|com)\/(?:docx|wiki|docs|doc)\/[^\s"'<>\u4e00-\u9fa5]+/gi,
    /\bBV[\w]{10}\b/g
  ]
  const urls = []
  const seen = new Set()
  for (const pattern of patterns) {
    const matches = raw.match(pattern) || []
    for (const match of matches) {
      const url = normalizeWorkflowUrl(match)
      const key = url.toLowerCase()
      if (url && !seen.has(key)) {
        seen.add(key)
        urls.push(url)
      }
    }
  }
  return urls
}

function cleanNodeUrl(n) {
  if (!n?.data) return ''
  const clean = extractWorkflowUrl(n.data.url || '')
  if (clean && clean !== n.data.url) n.data.url = clean
  return clean
}

function inputSourceType(n) {
  return n?.data?.sourceType === 'brief' ? 'brief' : 'video'
}

function inputDataSourceType(data) {
  return data?.sourceType === 'brief' ? 'brief' : 'video'
}

function setInputSourceType(n, type) {
  if (!n || !n.data || !['video', 'brief'].includes(type)) return
  n.data.sourceType = type
  n.data.s = ''
}

function setBriefFileInput(nodeId, el) {
  if (!nodeId) return
  if (el) briefFileInputs.set(nodeId, el)
  else briefFileInputs.delete(nodeId)
}

function openBriefDocPicker(n) {
  briefFileInputs.get(n?.id)?.click()
}

function handleBriefDocSelect(n, event) {
  const file = event?.target?.files?.[0]
  if (event?.target) event.target.value = ''
  if (file) importBriefDocument(n, file)
}

function handleBriefDocDrop(n, event) {
  if (n?.data) n.data.docDragging = false
  const file = event?.dataTransfer?.files?.[0]
  if (file) importBriefDocument(n, file)
}

function isSupportedBriefDocument(file) {
  return /\.(pdf|docx|doc)$/i.test(String(file?.name || ''))
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',', 2)[1] || '')
    reader.onerror = () => reject(reader.error || new Error('read file failed'))
    reader.readAsDataURL(file)
  })
}

async function importBriefDocument(n, file) {
  if (!n?.data || !file) return
  if (!isSupportedBriefDocument(file)) {
    n.data.s = '仅支持 PDF / Word 文档'
    return
  }
  const asBrief = inputSourceType(n) === 'brief'
  n.data.docParsing = true
  n.data.s = asBrief ? '正在解析 BF 文档...' : '正在解析文档...'
  try {
    const fileData = await readFileAsBase64(file)
    const data = await parseWorkflowDocument({ filename: file.name, size: file.size, file_data: fileData })
    const text = cleanTranscriptText(data.text || '')
    if (!text) throw new Error(data.error || '没有提取到文档文字')
    if (asBrief && !n.data.briefTitle) n.data.briefTitle = data.title || file.name.replace(/\.[^.]+$/, '')
    n.data.url = ''
    n.data.idea = text
    n.data.s = asBrief ? `BF 文档已导入：${file.name}` : `文档已导入：${file.name}`
  } catch (e) {
    n.data.s = '文档解析失败：' + (e.message || String(e))
  } finally {
    n.data.docParsing = false
    n.data.docDragging = false
  }
}
const IN_PORTS = [
  { key: 'main', label: '', y: 58 },
  { key: 'ref', label: '', y: 92 },
  { key: 'extra', label: '', y: 126 },
]

function inputPortY(n, index) {
  if (n?.type === 'input') return [70, 116, 162][index] || IN_PORTS[index]?.y || IN_PORTS[0].y
  return IN_PORTS[index]?.y || IN_PORTS[0].y
}

function typeCode(t) { return TYPES.find(x => x.type === t)?.c || t.toUpperCase() }

function stKind(n) {
  const s = n.data?.s || ''
  if (n.run) return 'running'
  if (!s || s === '待运行') return 'idle'
  if (String(s).toLowerCase().includes('error') || String(s).toLowerCase().includes('failed')) return 'error'
  if (String(s).toLowerCase().includes('done') || String(s).toLowerCase().includes('ready') || String(s).toLowerCase().includes('found') || String(s).toLowerCase().includes('analyzed') || /完成|就绪|找到|生成|已分析|已保存/.test(String(s))) return 'done'
  return 'pending'
}

function inPorts(n) {
  const used = lines.value.filter(l => l.t === n.id).map(l => l.tPort)
  return IN_PORTS.map((pt, i) => ({
    ...pt,
    y: inputPortY(n, i),
    used: used.includes(i)
  }))
}

async function saveFeishu(n) {
  const content = n?.type === 'gen'
    ? String(n.data?.out || '').trim()
    : (detailText(n) || outputText(n) || '')
  if (!content) return
  n.data.s = '写入飞书中...'
  try {
    const d = await writeFeishu({ tool: 'docx', title: n.label || '文案工作流', content, doc_id: '' })
    if (d.error || (d.code !== undefined && d.code !== 0)) {
      throw new Error(d.error || d.msg || '写入飞书失败')
    }
    n.data.s = d.doc_url || '写入完成'
  } catch (e) {
    n.data.s = 'error: ' + e.message
  }
}

function df(t) {
  if (t === 'input') return { url: '', idea: '', briefTitle: '', sourceType: 'video', s: '' }
  if (t === 'transcribe') return { s: '待运行', text: '' }
  if (t === 'analyze') return { s: '待运行', r: '' }
  if (t === 'hot') return { s: '待运行', rs: [], analysis: '', query: '', autoQuery: '', searchQueries: [], fallbackQueries: [], searchPlan: null, source: '' }
  if (t === 'platform') return { s: '待运行', rs: [], candidates: [], selected: [], keywords: '', autoKeywords: '', searchQueries: [], fallbackQueries: [], searchPlan: null, platforms: ['bilibili'], enabled: false }
  if (t === 'vec') return { s: '待运行', rs: [], query: '', autoQuery: '', searchQueries: [], fallbackQueries: [], search_intent: null, vectorPlan: null }
  if (t === 'sum') return { s: '待运行', txt: '' }
  if (t === 'idea') return { s: '待运行', list: [], sel: -1 }
  if (t === 'ideaCard') return { s: '已选择创意', title: '', text: '', entry: '', framework: '', ending: '', sourceIdeaId: '' }
  if (t === 'gen') return { s: '', mdl: 'GPT-5.5', words: String(DEFAULT_WORDS), out: '', styleRef: null, styleConfirmed: false, styleSkipped: false, styleReason: '' }
  return {}
}

let nID = 1
function mk(ty, x, y) {
  const data = df(ty)
  if (!Array.isArray(data.comments)) data.comments = []
  return {
    id: 'n' + (nID++),
    type: ty,
    label: TYPES.find(t => t.type === ty)?.l || ty,
    x,
    y,
    data
  }
}

const canvasRef = ref(null)
const nodes = ref([])
const lines = ref([])
const sel = ref(null)
const dl = ref(null)
const dlF = ref(null)
const dlDir = ref('out')
const dlPort = ref(0)
const hoverPort = ref(null)
const off = ref({ x: 0, y: 0 })
const dOff = ref({ x: 0, y: 0 })
const dWhat = ref(null)
const pendingNodeDrag = ref(null)
const sc = ref(1)
const interventionBusy = ref(false)
const interventionNote = ref('')
const detailSelectionState = reactive({ text: '', start: 0, end: 0, nodeId: null, field: '' })
const aiAnnotator = reactive({ show: false, x: 0, y: 0, quote: '' })
const ctx = reactive({ show: false, x: 0, y: 0, wx: 0, wy: 0, nid: null })
const outputViewer = reactive({ show: false, title: '', kicker: '', text: '' })
const planMode = reactive({
  open: false,
  question: '',
  draft: '',
  messages: [],
  confirmed: false,
  contextStatus: '',
  sourceContext: '',
  collecting: false,
  busy: false,
})
const workflowStyles = ref([])
const styleLoading = ref(false)
const styleReady = ref(false)
const WORKFLOW_PREFILL_URL_KEY = 'usagi_workflow_prefill_url'
const briefFileInputs = new Map()

const zoomLabel = computed(() => `${Math.round(sc.value * 100)}%`)
const doneCount = computed(() => nodes.value.filter(n => stKind(n) === 'done').length)
const selectedNode = computed(() => nodes.value.find(n => n.id === sel.value) || null)
const selectedComments = computed(() => selectedNode.value?.data?.comments || [])
const activeWorkflowStyle = computed(() => {
  const ref = selectedNode.value?.data?.styleRef
  if (!ref?.id) return null
  return workflowStyles.value.find(style => style.id === ref.id) || ref
})

function selectedPlatformCount(n) {
  return (n?.data?.candidates || []).filter(item => item.selected).length
}

function refreshPlatformSelection(n) {
  if (!n?.data) return
  const selected = (n.data.candidates || []).filter(item => item.selected)
  n.data.selected = selected
  n.data.rs = selected
}

function togglePlatformCandidate(n, item) {
  if (!n || !item || n.run) return
  item.selected = !item.selected
  refreshPlatformSelection(n)
}

function platformCandidateStatus(item) {
  if (!item) return ''
  if (item.transcript_status === 'running') return '转写中'
  if (item.transcript_status === 'completed') return '已转写'
  if (item.transcript_status === 'error') return '转写失败'
  return item.selected ? '已选' : '候选'
}

function platformCandidateUrl(item) {
  if (!item) return ''
  if (item.url) return item.url
  if (item.bvid) return 'https://www.bilibili.com/video/' + item.bvid
  return ''
}

async function transcribeSelectedPlatformCandidates(n) {
  if (!n || n.run) return
  const selected = (n.data.candidates || []).filter(item => item.selected)
  if (!selected.length) {
    n.data.s = '请先选择要转写的 B站候选'
    return
  }
  n.run = true
  let done = 0
  try {
    for (let i = 0; i < selected.length; i += 1) {
      const item = selected[i]
      const url = platformCandidateUrl(item)
      item.transcript_status = 'running'
      item.transcript_error = ''
      n.data.s = 'B站转写中 ' + (i + 1) + '/' + selected.length
      if (!url) {
        item.transcript_status = 'error'
        item.transcript_error = '缺少视频链接'
        continue
      }
      try {
        const d = await transcribeVideo('bilibili', url)
        const text = cleanTranscriptText(d.text || '')
        item.transcript = text
        item.title = item.title || d.title || ''
        item.bvid = item.bvid || d.bvid || ''
        item.transcript_status = text ? 'completed' : 'error'
        item.transcript_error = text ? '' : (d.error || '没有拿到可用转写文本')
        if (text) done += 1
      } catch (e) {
        item.transcript_status = 'error'
        item.transcript_error = e.message || String(e)
      }
      refreshPlatformSelection(n)
    }
    n.data.s = done ? ('B站转写完成 ' + done + '/' + selected.length) : 'B站转写未获得可用文本'
  } finally {
    refreshPlatformSelection(n)
    n.run = false
  }
}

function ideaCardStyleContext(card) {
  const rep = gD(card, 'sum')
  return `${rep || ''}\n${card?.data?.text || ''}`.trim()
}

function ideaCardStyleChoices(card) {
  const context = ideaCardStyleContext(card)
  return [...workflowStyles.value]
    .map(style => ({
      ...style,
      score: styleMatchScore(style, context),
      reason: buildStyleReason(style, context)
    }))
    .sort((a, b) => b.score - a.score || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 3)
}

function ideaCardStyleOptions(card) {
  const ranked = ideaCardStyleChoices(card)
  const rankedIds = new Set(ranked.map(style => style.id))
  const rest = workflowStyles.value
    .filter(style => !rankedIds.has(style.id))
    .slice(0, 40)
  return ranked.concat(rest)
}

function quickStyleChoices(card) {
  return ideaCardStyleChoices(card)
}

function selectIdeaCardStyle(card, style) {
  if (!card?.data) return
  selectNodeStyle(card, style, 'manual', style.reason || buildStyleReason(style, ideaCardStyleContext(card)))
  card.data.s = '已选风格，点击生成文案'
}

function selectIdeaCardStyleById(card, id) {
  if (!card?.data) return
  if (!id || id === '__none') {
    setIdeaCardUnstyled(card)
    return
  }
  const style = workflowStyles.value.find(item => String(item.id) === String(id))
  if (style) selectIdeaCardStyle(card, style)
}

function setIdeaCardUnstyled(card) {
  clearNodeStyle(card)
  if (card?.data) {
    card.data.styleSkipped = true
    card.data.s = '不使用风格，点击生成文案'
    card.data.styleReason = '不使用风格'
  }
}

function genRunLabel(n) {
  if (n?.run) return '生成中'
  return '生成文案'
}

function runGenAction(n) {
  selectNode(n)
  if (n?.type === 'ideaCard') {
    generateIdeaCardCopy(n)
    return
  }
  runN(n, { confirmedStyle: true })
}

function runCurrentNode(n) {
  if (!n) return
  if (n.type === 'ideaCard') {
    generateIdeaCardCopy(n)
    return
  }
  runN(n)
}

function textBlock(value, fallback = '') {
  return String(value || fallback || '').trim()
}

function section(title, body) {
  const text = textBlock(body)
  return text ? `## ${title}\n${text}` : ''
}

function numbered(items = []) {
  return (items || []).map((item, i) => `${i + 1}. ${item}`).join('\n')
}

function bullets(items = []) {
  return (items || []).filter(Boolean).map(item => `- ${item}`).join('\n')
}

function compactLine(value, max = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > max ? text.slice(0, max) + '...' : text
}

function makeStylePreview(style, max = 160) {
  const text = String(style || '').replace(/[#*_>`-]/g, '').replace(/\s+/g, ' ').trim()
  return text.length > max ? text.slice(0, max) + '...' : text
}

function formatStylePlatform(platform) {
  if (platform === 'bilibili') return 'B站'
  if (platform === 'douyin') return '抖音'
  if (platform === 'project') return '项目'
  return platform || '风格'
}

async function loadStyles(force = false) {
  if (styleLoading.value) return
  if (!force && (workflowStyles.value.length || styleReady.value)) return
  styleLoading.value = true
  try {
    const data = await listWorkflowStyles()
    workflowStyles.value = Array.isArray(data.styles) ? data.styles : []
    styleReady.value = true
  } catch (e) {
    workflowStyles.value = []
    styleReady.value = false
  } finally {
    styleLoading.value = false
  }
}

function withTimeout(promise, ms, label = '操作') {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + '超时')), ms)
    })
  ]).finally(() => clearTimeout(timer))
}

function lightStyle(style) {
  if (!style) return null
  return {
    id: style.id,
    name: style.name,
    type: style.type,
    group: style.group,
    platform: style.platform,
    preview: style.preview || makeStylePreview(style.style),
    style: style.style
  }
}

function selectNodeStyle(n, style, source = 'manual', reason = '') {
  if (!n?.data) return
  n.data.styleRef = lightStyle(style)
  n.data.styleConfirmed = source === 'manual'
  n.data.styleSkipped = false
  n.data.styleSource = source
  n.data.styleReason = reason
  if (source === 'manual') n.data.s = 'style selected, ready to generate'
}

function clearNodeStyle(n) {
  if (!n?.data) return
  n.data.styleRef = null
  n.data.styleConfirmed = false
  n.data.styleSkipped = true
  n.data.styleReason = ''
}

function changeNodeStyle(n) {
  if (!n?.data) return
  n.data.styleRef = null
  n.data.styleConfirmed = false
  n.data.styleSkipped = false
  n.data.styleReason = ''
  n.data.s = '请选择账号风格，或点不使用风格'
}

function setUnstyledChoice(n) {
  clearNodeStyle(n)
  if (n?.data) n.data.s = 'no style selected, ready to generate'
  if (n?.data) n.data.styleReason = '不使用风格'
}

function confirmNodeStyle(n) {
  if (!n?.data) return
  n.data.styleConfirmed = true
  n.data.styleSkipped = false
  n.run = false
  selectNode(n)
  runN(n, { confirmedStyle: true })
}

function styleMatchScore(style, text) {
  const haystack = `${style.name || ''} ${style.platform || ''} ${style.preview || ''} ${style.style || ''}`.toLowerCase()
  const source = String(text || '').toLowerCase()
  let score = 0
  ;['游戏', '剧情', '故事', '情绪', '感动', '玩家', '二游', '主机', 'steam'].forEach(word => {
    if (source.includes(word) && haystack.includes(word)) score += 8
  })
  ;['科技', '数码', '互联网', 'ai', '手机', '电脑'].forEach(word => {
    if (source.includes(word) && haystack.includes(word)) score += 7
  })
  ;['热点', '争议', '翻车', '官宣', '联动'].forEach(word => {
    if (source.includes(word) && haystack.includes(word)) score += 5
  })
  String(style.name || '').split(/\s+/).forEach(word => {
    if (word && source.includes(word.toLowerCase())) score += 10
  })
  return score + (style.type === 'project' ? 1 : 0)
}

async function recommendStyleForNode(n, rep, idea) {
  await withTimeout(loadStyles(), 5000, '风格加载').catch(() => {})
  if (!workflowStyles.value.length) return null
  const context = `${rep || ''}\n${idea || ''}`.slice(0, 5000)
  const picked = [...workflowStyles.value].sort((a, b) => styleMatchScore(b, context) - styleMatchScore(a, context))[0]
  if (!picked) return null
  const reason = buildStyleReason(picked, context)
  selectNodeStyle(n, picked, 'recommended', reason)
  return picked
}

function buildStyleReason(style, context) {
  const text = String(context || '')
  if (/游戏|玩家|剧情|steam|二游|主机/i.test(text)) return '内容偏游戏/玩家叙事，优先匹配相近的账号表达方式。'
  if (/科技|数码|互联网|AI|手机|电脑/i.test(text)) return '内容偏科技数码，优先匹配解释型和观点型风格。'
  if (/热点|争议|翻车|官宣|联动/i.test(text)) return '内容偏热点讨论，优先匹配节奏明确、观点推进强的风格。'
  return `${style.name} 的风格卡与当前材料关键词更接近。`
}

function sourceLabel(text, index = 0) {
  const match = String(text || '').match(/^来源\s+(\d+):\s*(.+)$/)
  return match ? `来源 ${match[1]}：${match[2]}` : `来源 ${index + 1}`
}

function formatTranscriptOutput(text) {
  const raw = textBlock(text)
  if (!raw) return ''
  const chunks = raw.split(/\n\n(?=来源\s+\d+:)/).filter(Boolean)
  if (chunks.length <= 1) return section('采集内容', raw)
  return chunks.map((chunk, i) => {
    const lines = chunk.split('\n')
    const title = sourceLabel(lines.shift(), i)
    return section(title, lines.join('\n').trim())
  }).join('\n\n')
}

function isFeishuWorkflowUrl(url) {
  return /(?:feishu|larksuite)\.(?:cn|com)\/(?:docx|wiki|docs|doc)\//i.test(String(url || ''))
}

function getFeishuWorkflowDocId(url) {
  const clean = normalizeWorkflowUrl(url)
  return clean.match(/(?:docx|wiki)\/([a-zA-Z0-9_-]{8,})/)?.[1] || clean.match(/([a-zA-Z0-9_-]{10,})/)?.[1] || ''
}

function isDouyinWorkflowUrl(url) {
  return /(?:douyin\.com|v\.douyin\.com)/i.test(String(url || ''))
}

function isBilibiliWorkflowUrl(url) {
  return /(?:bilibili\.com|b23\.tv|^BV)/i.test(String(url || ''))
}

function collectManualInputText(input) {
  const parts = []
  const idea = cleanTranscriptText(input?.idea || '')
  if (idea) parts.push(idea)
  return parts.join('\n\n')
}

function collectInputSourceJobs(n) {
  const jobs = []
  const sources = inputSources(n).map((source, sourceIndex) => ({
    nodeId: source.node?.id || '',
    sourceIndex,
    data: JSON.parse(JSON.stringify(source.data || {})),
  }))
  sources.forEach((source, sourceIndex) => {
    const input = source.data || {}
    const prefix = sources.length > 1 ? '输入源 ' + (sourceIndex + 1) : ''
    const urls = extractWorkflowUrls(input.url || '')
    if (inputDataSourceType(input) === 'brief') {
      jobs.push({ kind: 'brief', input, prefix, urls, sourceIndex, nodeId: source.nodeId })
      return
    }
    const manualText = collectManualInputText(input)
    if (manualText) jobs.push({ kind: 'manual', prefix, text: manualText, sourceIndex, nodeId: source.nodeId })
    urls.forEach((url, urlIndex) => jobs.push({ kind: 'url', prefix, url, sourceIndex, urlIndex, nodeId: source.nodeId }))
  })
  return jobs
}

async function runMultiSourceTranscribe(n) {
  const jobs = collectInputSourceJobs(n)
  const blocks = []
  const errors = []
  if (!jobs.length) return { blocks, errors, total: 0 }
  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i]
    n.data.s = '多源采集中 ' + (i + 1) + '/' + jobs.length
    try {
      if (job.kind === 'manual') {
        blocks.push([job.prefix, '手动补充', job.text].filter(Boolean).join('\n'))
        continue
      }
      if (job.kind === 'brief') {
        const title = job.input.briefTitle || '商单 BF'
        let rawBrief = cleanTranscriptText(job.input.idea || '')
        const briefUrl = (job.urls || []).find(isFeishuWorkflowUrl)
        if (briefUrl) {
          const d = await collectFeishuWorkflowText(briefUrl)
          rawBrief = cleanTranscriptText(d.text || rawBrief || d.error || '')
          if (!job.input.briefTitle && d.title) job.input.briefTitle = d.title
        }
        if (rawBrief) blocks.push([job.prefix, buildBriefDigest(rawBrief, job.input.briefTitle || title)].filter(Boolean).join('\n'))
        else errors.push((job.prefix || 'BF') + '：需要 BF 内容')
        continue
      }
      const collected = await collectWorkflowSource(job.url, i + 1)
      if (collected.ok) blocks.push([job.prefix, collected.label, collected.text].filter(Boolean).join('\n'))
      else errors.push([job.prefix, collected.label + '：' + collected.error].filter(Boolean).join('\n'))
    } catch (e) {
      errors.push([job.prefix, '来源 ' + (i + 1) + '：' + (e.message || String(e))].filter(Boolean).join('\n'))
    }
  }
  return { blocks, errors, total: jobs.length }
}

async function collectFeishuWorkflowText(url) {
  const docId = getFeishuWorkflowDocId(url)
  const d = await readFeishu({ url, doc_id: docId })
  return {
    title: d.title || '',
    text: cleanTranscriptText(d.text || ''),
    error: d.error || d.msg || ''
  }
}

async function collectWorkflowSource(url, index) {
  const currentUrl = normalizeWorkflowUrl(url)
  if (isFeishuWorkflowUrl(currentUrl)) {
    const d = await collectFeishuWorkflowText(currentUrl)
    return {
      ok: Boolean(d.text),
      label: '来源 ' + index + ': 飞书文档 ' + currentUrl,
      text: d.text,
      error: d.error || '飞书文档未读取到可用内容'
    }
  }
  if (isDouyinWorkflowUrl(currentUrl) || isBilibiliWorkflowUrl(currentUrl)) {
    const platform = isDouyinWorkflowUrl(currentUrl) ? 'douyin' : 'bilibili'
    const d = await transcribeVideo(platform, currentUrl)
    const text = cleanTranscriptText(d.text || '')
    return {
      ok: Boolean(text),
      label: '来源 ' + index + ': ' + (platform === 'douyin' ? '抖音视频 ' : 'B站视频 ') + currentUrl,
      text,
      error: d.error || '视频未采集到可用文本'
    }
  }
  return {
    ok: false,
    label: '来源 ' + index + ': ' + currentUrl,
    text: '',
    error: '暂不支持的链接类型'
  }
}

function buildBriefDigest(raw, title = '商单 BF') {
  const text = cleanTranscriptText(raw || '')
  if (!text) return ''
  const lines = text.split('\n').map(x => x.trim()).filter(Boolean)
  const pickLines = (patterns, limit = 14) => {
    const picked = []
    for (const line of lines) {
      if (picked.length >= limit) break
      if (line.length > 260) continue
      if (patterns.some(pattern => pattern.test(line))) picked.push(line)
    }
    return picked
  }
  const directions = pickLines([/创作|方向|内容方向|形式|适用作者|参考|脚本|话术|卖点|切入|框架|口播|视频/i], 24)
  const requirements = pickLines([/要求|必须|不可|不能|注意|风险|打码|保密|外传|审核|口径|限制|禁/i], 24)
  const product = pickLines([/产品|游戏|版本|联动|福利|玩法|活动|更新|周年|卖点|亮点|素材/i], 28)
  const links = (text.match(/https?:\/\/[^\s)）\]}>"'，。；；]+/g) || []).slice(0, 18)
  const fallback = lines.filter(line => line.length <= 220).slice(0, 80)
  return [
    `商单 BF｜${title}`,
    '',
    '## 项目与核心信息',
    (product.length ? product : fallback.slice(0, 18)).map(x => '- ' + x).join('\n'),
    '',
    '## 创作方向/交付参考',
    (directions.length ? directions : fallback.slice(18, 36)).map(x => '- ' + x).join('\n'),
    '',
    '## 硬性要求/风险提醒',
    (requirements.length ? requirements : ['请严格遵守原 BF 中的素材权限、保密、平台口径和客户要求。']).map(x => '- ' + x).join('\n'),
    links.length ? '\n## 链接/素材\n' + links.map(x => '- ' + x).join('\n') : '',
    '',
    '## 原 BF 摘要截取',
    text.slice(0, 6500)
  ].filter(Boolean).join('\n')
}

function buildBriefAnalyzePrompt(txt) {
  return `你是商单 BF 策略拆解师。请把这份需求文档整理成后续文案创作可直接使用的创作简报。

输出要求：
- 用 Markdown。
- 控制在 1200 字以内。
- 优先提炼硬性要求、卖点、创作方向、禁区、素材线索。
- 不要逐段复述原文。

格式：
## 项目一句话
## 核心卖点
## 必须覆盖
## 创作方向
## 禁区/风险
## 可用素材与参考
## 建议切入角度

原始 BF：
${String(txt || '').substring(0, 12000)}`
}

function formatIdeaList(list = []) {
  const items = (list || []).map((row, i) => {
    const parsed = parseIdeaCardDetailText(row, i)
    return [
      `### ${i + 1}. ${parsed.title}`,
      parsed.entry ? `切入点：${parsed.entry}` : '',
      parsed.framework ? `框架：${parsed.framework}` : '',
      parsed.ending ? `结尾：${parsed.ending}` : '',
      parsed.text && !parsed.entry ? parsed.text : ''
    ].filter(Boolean).join('\n')
  })
  return items.join('\n\n')
}

function outputText(n) {
  if (!n) return ''
  if (n.type === 'sum') return detailText(n)
  if (n.type === 'gen') return detailText(n)
  if (n.type === 'ideaCard') return detailText(n)
  if (n.type === 'analyze') return detailText(n)
  if (n.type === 'transcribe') return detailText(n)
  return nodeText(n)
}

function detailText(n) {
  if (!n) return ''
  if (n.data?.manualDetail) return n.data.manualDetail
  if (n.type === 'input') return [section('输入链接', n.data.url), section('补充想法', n.data.idea)].filter(Boolean).join('\n\n')
  if (n.type === 'transcribe') return formatTranscriptOutput(n.data.text)
  if (n.type === 'analyze') return section('结构拆解', n.data.r)
  if (n.type === 'sum') return section('汇总报告', n.data.txt)
  if (n.type === 'gen') return section('生成文案', n.data.out)
  if (n.type === 'ideaCard') {
    return section('已选创意', formatIdeaList([stripIdeaCardDisplayText(n.data.text) || [n.data.title, n.data.entry, n.data.framework, n.data.ending].filter(Boolean).join(' | ')]))
  }
  if (n.type === 'idea') return section('创意方向', formatIdeaList(n.data.list || []))
  if (n.type === 'platform') return platformDetailText(n)
  if (n.type === 'hot') return hotDetailText(n)
  if (n.type === 'vec') return formatSearchResults(n.data.rs)
  return outputText(n)
}

function formatPlatformResults(n) {
  const results = n?.data?.selected?.length ? n.data.selected : (n?.data?.rs || [])
  const withTranscript = results.filter(r => String(r.transcript || '').trim())
  if (!withTranscript.length) return ''
  const cleanHeader = section('B站视频转写', bullets([
    '关键词：' + (n?.data?.keywords || '-'),
    '仅纳入已完成转写的视频'
  ]))
  const cleanBody = withTranscript.map((r, i) => [
    `### ${i + 1}. ${r.title || r.text || '未命名视频'}`,
    bullets([
      r.author ? '作者：' + r.author : '',
      r.metrics ? '数据：' + r.metrics : '',
      r.url || ''
    ]),
    section('转写摘要', compactLine(r.transcript, 500))
  ].filter(Boolean).join('\n')).join('\n\n')
  return [cleanHeader, cleanBody].filter(Boolean).join('\n\n')
  const header = [
    'B站关联视频转写',
    '关键词: ' + (n?.data?.keywords || '-'),
    '仅纳入已完成转写的视频。'
  ].join('\n')
  const body = withTranscript.map((r, i) => [
    (i + 1) + '. [bilibili] ' + (r.title || r.text || ''),
    r.author ? '作者: ' + r.author : '',
    r.metrics ? '数据:  ' + r.metrics : '',
    '转写原文: ' + r.transcript,
    r.url || ''
  ].filter(Boolean).join('\n')).join('\n\n')
  return header + '\n\n' + body
}

function platformDetailText(n) {
  const candidates = n?.data?.candidates || []
  const selected = n?.data?.selected || []
  const results = candidates.length ? candidates : (n?.data?.rs || [])
  const searchQueries = uniqueVectorList(n?.data?.searchQueries || [], 4)
  const fallbackQueries = uniqueVectorList(n?.data?.fallbackQueries || [], 3)
  const cleanHeader = section('B站关联视频搜索', bullets([
    '关键词：' + (n?.data?.keywords || '-'),
    searchQueries.length ? 'AI主体词：' + searchQueries.join(' / ') : '',
    fallbackQueries.length ? '备用词：' + fallbackQueries.join(' / ') : '',
    n?.data?.searchPlan?.reason ? '取词理由：' + n.data.searchPlan.reason : '',
    '候选：' + candidates.length,
    '入选转写：' + selected.length + '/3',
    '当前模块仅支持 B站候选筛选'
  ]))
  if (!results.length) return [cleanHeader, '暂无候选。'].filter(Boolean).join('\n\n')
  const cleanBody = results.map((r, i) => [
    `### ${i + 1}. ${r.selected ? '已选' : '候选'}：${r.title || r.text || '未命名视频'}`,
    bullets([
      r.author ? '作者：' + r.author : '',
      r.metrics ? '数据：' + r.metrics : '',
      r.relevance !== undefined ? '相关性：' + r.relevance : '',
      r.score !== undefined ? '分数：' + r.score : '',
      r.reason ? '入选原因：' + r.reason : '',
      r.url || ''
    ]),
    r.transcript ? section('转写摘要', compactLine(r.transcript, 360)) : '转写：未获取'
  ].filter(Boolean).join('\n')).join('\n\n')
  return [cleanHeader, cleanBody].filter(Boolean).join('\n\n')
  const header = [
    'B站关联视频搜索',
    '关键词: ' + (n?.data?.keywords || '-'),
    '候选: ' + candidates.length + '；入选转写: ' + selected.length + '/3',
    '当前模块仅支持 B站；抖音关键词视频搜索暂不接入。'
  ].join('\n')
  if (!results.length) return header + '\n暂无候选。'
  return header + '\n\n' + results.map((r, i) => [
    (i + 1) + '. ' + (r.selected ? '已选' : '候选') + ' [bilibili] ' + (r.title || r.text || ''),
    r.author ? '作者: ' + r.author : '',
    r.metrics ? '数据:  ' + r.metrics : '',
    r.relevance !== undefined ? '相关性: ' + r.relevance : '',
    r.score !== undefined ? '分数: ' + r.score : '',
    r.reason ? '原因: ' + r.reason : '',
    r.transcript ? '转写原文: ' + r.transcript : '未获取转写原文',
    r.url || ''
  ].filter(Boolean).join('\n')).join('\n\n')
}


function hotDetailText(n) {
  const data = n?.data || {}
  const results = data.rs || []
  const compact = (value, max = 360) => {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/特别声明[\s\S]*$/g, '')
      .trim()
    return text.length > max ? text.slice(0, max) + '...' : text
  }
  const usefulSources = (data.filteredResults || results || [])
    .filter(r => {
      const status = String(r?.content_status || r?.status || '').toLowerCase()
      const url = String(r?.link || r?.url || '')
      const text = String(r?.content || r?.summary || r?.text || '').trim()
      if (!text) return false
      if (status.includes('snippet')) return false
      if (/douyin\.com\/search|bilibili\.com\/video/i.test(url) && text.length < 120) return false
      return true
    })
    .slice(0, 3)
  const cleanBlocks = []
  if (data.query) cleanBlocks.push(section('背景搜索词', data.query))
  if (data.searchQueries?.length || data.fallbackQueries?.length || data.searchPlan?.reason) {
    cleanBlocks.push(section('AI取词判断', bullets([
      data.searchQueries?.length ? '主体词：' + uniqueVectorList(data.searchQueries, 4).join(' / ') : '',
      data.fallbackQueries?.length ? '备用词：' + uniqueVectorList(data.fallbackQueries, 3).join(' / ') : '',
      data.searchPlan?.reason ? '理由：' + data.searchPlan.reason : ''
    ])))
  }
  if (data.mode === 'web_research') {
    if (data.analysis) cleanBlocks.push(section('模型联网资料', compact(data.analysis, 1400)))
    if (data.source) cleanBlocks.push(section('检索方式', data.source))
    return cleanBlocks.join('\n\n')
  }
  if (data.analysis) cleanBlocks.push(section('有效信息总结', compact(data.analysis, 900)))
  if (data.filterNote) cleanBlocks.push(section('过滤判断', data.filterNote))
  if (usefulSources.length) {
    cleanBlocks.push(section('可参考来源（已过滤 snippet/搜索页）', usefulSources.map((r, i) => [
      `### ${i + 1}. ${r.title || r.text || '来源'}`,
      bullets([r.link || r.url || '']),
      compact(r.content || r.summary || r.text || '', 260)
    ].filter(Boolean).join('\n')).join('\n\n')))
  }
  return cleanBlocks.join('\n\n')
}



function formatSearchResults(results = []) {
  const picked = filterVectorResults(results, 2)
  if (!picked.length) return ''
  const items = picked.map((r, i) => [
    `### ${i + 1}. ${r.title || r.hook || r.account || '素材结果'}`,
    bullets([
      r.score !== undefined ? '匹配分：' + r.score : '',
      r.vector_query ? '检索词：' + r.vector_query : '',
      r.vector_match_scope ? '参考层级：' + r.vector_match_scope : '',
      Array.isArray(r.matched_terms) && r.matched_terms.length ? '命中词：' + r.matched_terms.slice(0, 5).join('、') : '',
      r.account ? '账号：' + r.account : '',
      r.scene ? '场景：' + r.scene : '',
      r.link || r.url || '',
      r.date || ''
    ]),
    compactLine(vectorResultText(r), 900)
  ].filter(Boolean).join('\n'))
  return section('向量库表达参考（仅采用高相关 Top 2）', items.join('\n\n'))
}

function vectorResultText(item) {
  const raw = String(item?.original_text || item?.originalText || item?.text || item?.content || item?.summary || item?.snippet || item?.golden_line || '').trim()
  const source = String(item?.source || '').trim()
  const text = raw || (source.length > 80 ? source : '')
  const match = text.match(/转写原文[：:]\s*([\s\S]+)$/)
  return (match ? match[1] : text).trim()
}

const VECTOR_QUERY_NOISE = new Set([
  '这个', '一个', '不是', '但是', '因为', '所以', '然后', '如果', '我们', '他们', '大家',
  '视频', '内容', '素材', '文案', '分析', '结构', '切入点', '切入', '框架', '背景', '搜索',
  '参考', '表达', '方式', '原文', '总结', '摘要', '来源', '信息', '相关', '资料', '可以',
  '需要', '建议', '输出', '格式', '使用', '保留', '注意', '要求', '说明', '可选', '最多',
  '一句话', '主线', '论据', '结尾', '风险', '提醒', '项目', '产品', '核心', '必须覆盖',
  '原切入点', '主线结构', '关键论据', '结尾方式', '风险提醒', '创作方向', '建议切入角度',
  '账号', '平台', '标题', '发布时间', '热度', '转写原文', '金句',
  '抖音', '快手', '小红书', '视频号', 'B站', 'b站', '哔哩哔哩',
  'title', 'golden', 'douyin', 'bilibili',
  '离谱', '逆天', '炸裂', '震惊', '没想到', '太狠', '太强', '绝了',
  '商单', 'brief', 'bf', 'http', 'https', 'www', 'com'
])

const VECTOR_SIGNAL_TERMS = [
  '游戏圈', '大瓜', '爆料', '爆点', '翻车', '塌房', '反转', '反差', '冲突', '争议',
  '质疑', '悬念', '揭秘', '避雷', '电诈', '诈骗', '网恋', '跨国', '套路', '骗局',
  '开场', '开头', '前三秒', '钩子', '悬疑', '猎奇', '吐槽', '测评', '攻略', '教程',
  '福利', '活动', '版本', '联动', '赛事', '战队', '冠军', '对手', '排名', '看点',
  '卖点', '痛点', '需求', '禁区', '授权', '组件', '植入', '口播', '信息流'
]

const VECTOR_FRAME_TERMS = new Set([
  '游戏圈', '大瓜', '爆料', '爆点', '翻车', '塌房', '反转', '反差', '冲突', '争议',
  '质疑', '悬念', '揭秘', '避雷', '开场', '开头', '前三秒', '钩子', '悬疑', '猎奇',
  '吐槽', '看点'
])

function cleanVectorTerm(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^(账号|平台|标题|发布时间|热度|转写原文|金句|title|golden)\s*[：:]\s*/i, '')
    .replace(/^[\s#>*\-—•·、.。]+/g, '')
    .replace(/^(?:\d+|[一二三四五六七八九十]+)[、.。\)\）\s]+/g, '')
    .replace(/^(关于|围绕|针对|这期|本期|这条|这个|一个|如何|为什么|怎么|帮我|请你|请|写一篇|做一个)+/g, '')
    .replace(/(的视频|的内容|的素材|的文案|相关|资料|参考|表达|方式|结构|分析|搜索)+$/g, '')
    .replace(/[，。！？；：、,.!?;:()[\]【】《》"'“”‘’]/g, ' ')
    .replace(/[　\s]+/g, ' ')
    .trim()
}

function vectorTermKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '')
}

function isVectorNoiseTerm(value) {
  const term = cleanVectorTerm(value)
  const key = vectorTermKey(term)
  if (!term || key.length < 2 || key.length > 28) return true
  if (/^\d+$/.test(key)) return true
  if (VECTOR_QUERY_NOISE.has(term) || VECTOR_QUERY_NOISE.has(key)) return true
  return false
}

function isVectorBannedTerm(value, bannedTerms = []) {
  const key = vectorTermKey(value)
  if (!key) return true
  return (bannedTerms || []).some(term => {
    const banned = vectorTermKey(term)
    return banned && (key === banned || key.includes(banned))
  })
}

function uniqueVectorList(list = [], limit, bannedTerms = []) {
  const seen = new Set()
  const out = []
  ;(list || []).forEach(item => {
    const value = cleanVectorTerm(item)
    const key = vectorTermKey(value)
    if (!value || isVectorNoiseTerm(value) || isVectorBannedTerm(value, bannedTerms) || seen.has(key)) return
    seen.add(key)
    out.push(value)
  })
  return typeof limit === 'number' ? out.slice(0, limit) : out
}

function tokenizeVectorText(value, limit = 30) {
  const source = String(value || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\r?\n/)
    .filter(line => !/^\s*(账号|平台|发布时间|热度|转写原文)\s*[：:]/.test(line))
    .join('\n')
    .replace(/[，。！？；：、,.!?;:()[\]【】《》"'“”‘’]/g, ' ')
    .replace(/[　\s]+/g, ' ')
    .trim()
  const words = source.match(/#[\u4e00-\u9fa5A-Za-z0-9_]{2,24}|[A-Za-z][A-Za-z0-9_-]{1,30}|[\u4e00-\u9fa5]{2,12}/g) || []
  return uniqueVectorList(words.map(word => word.startsWith('#') ? word.slice(1) : word), limit)
}

function extractPrioritySubjectTerms(text, limit = 10) {
  const source = String(text || '')
  const terms = []
  const subjectLabels = '(?:产品|游戏|角色|人物|战队|队伍|选手|赛事|活动|版本|项目|标题|主题|看点|主角|阵容|对阵|brief|title)'
  source.split(/\r?\n/).forEach(line => {
    const match = line.trim().match(new RegExp('^(?:[-*]\\s*)?' + subjectLabels + '\\s*[：:]\\s*(.+)$', 'i'))
    if (match) terms.push(...tokenizeVectorText(match[1], 6))
  })
  ;(source.match(/\b[A-Za-z][A-Za-z0-9_-]{1,30}\b/g) || []).forEach(word => terms.push(word))
  ;(source.match(/《([^》]{2,28})》/g) || []).forEach(value => terms.push(value.replace(/[《》]/g, '')))
  ;(source.match(/#[\u4e00-\u9fa5A-Za-z0-9_]{2,24}/g) || []).forEach(value => terms.push(value.slice(1)))
  return uniqueVectorList(terms, limit)
}

function pickSubjectFallbackQuery(text, limit = 4) {
  const priorityTerms = extractPrioritySubjectTerms(text, 10)
  const signalTerms = findVectorSignalTerms(text)
  const query = normalizeVectorQuery(priorityTerms.concat(signalTerms).slice(0, limit + 3), limit)
  return query && isUsefulVectorQuery(query) ? query : ''
}

function extractVectorSearchQuery(text) {
  const terms = buildVectorSearchTerms(text)
  return normalizeVectorQuery([].concat(terms.titleTerms, terms.signalTerms, terms.sectionTerms, terms.generalTerms).slice(0, 8))
}

function normalizeVectorQuery(value, limit = 5, bannedTerms = []) {
  const raw = Array.isArray(value) ? value.join(' ') : String(value || '')
  const words = raw.includes(' ')
    ? raw.split(/\s+/)
    : tokenizeVectorText(raw, limit + 4)
  return uniqueVectorList(words, limit, bannedTerms).join(' ')
}

function splitVectorQueryInput(value) {
  return String(value || '')
    .split(/[\n/|；;]+/)
    .map(query => normalizeVectorQuery(query, 6))
    .filter(Boolean)
}

function findVectorSignalTerms(text) {
  const source = String(text || '')
  const lower = source.toLowerCase()
  return uniqueVectorList(VECTOR_SIGNAL_TERMS.filter(term => {
    const value = String(term || '')
    return /[a-z]/i.test(value) ? lower.includes(value.toLowerCase()) : source.includes(value)
  }), 10)
}

function extractVectorPhrases(text) {
  const source = String(text || '')
  const phrases = []
  const quoted = /[《【「“](.{2,36}?)[》】」”]/g
  let match
  while ((match = quoted.exec(source))) phrases.push(match[1])
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  lines.slice(0, 8).forEach(line => {
    if (/^(账号|平台|发布时间|热度|转写原文)\s*[：:]/.test(line)) return
    const labeled = line.match(/^(标题|title|金句|golden)\s*[：:]\s*(.+)$/i)
    if (labeled) {
      phrases.push(labeled[2])
      return
    }
    if (line.length <= 72 && !/^#{1,6}\s*/.test(line)) phrases.push(line)
  })
  lines.forEach(line => {
    const kv = line.match(/^(?:[-*]\s*)?(标题|title|主题|选题|项目|产品|游戏|活动|看点|切入点|原切入点|核心卖点|创作方向|建议切入角度)[：:]\s*(.+)$/i)
    if (kv) phrases.push(kv[2])
  })
  return uniqueVectorList(phrases, 12)
}

function extractVectorSectionLines(text) {
  const lines = String(text || '').split(/\r?\n/)
  const out = []
  let active = false
  const sectionPattern = /^(?:#{1,6}\s*)?(素材一句话|原切入点|主线结构|关键论据|结尾方式|风险提醒|项目一句话|核心卖点|必须覆盖|创作方向|禁区|可用素材|建议切入角度|看点|需求|卖点|痛点)\b/
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^#{1,6}\s*/.test(line)) {
      active = sectionPattern.test(line)
      continue
    }
    if (active) out.push(line)
    if (/^(?:[-*]\s*)?(素材一句话|原切入点|切入点|核心卖点|创作方向|建议切入角度|风险提醒|看点|需求|卖点|痛点)[：:]/.test(line)) {
      out.push(line.replace(/^[^：:]+[：:]\s*/, ''))
    }
  }
  return uniqueVectorList(out, 16)
}

function buildVectorSearchTerms(text) {
  const source = String(text || '')
  const phrases = extractVectorPhrases(source)
  const sectionLines = extractVectorSectionLines(source)
  const phraseTerms = phrases.flatMap(phrase => [].concat(findVectorSignalTerms(phrase), tokenizeVectorText(phrase, 6)))
  const sectionTerms = sectionLines.flatMap(line => [].concat(findVectorSignalTerms(line), tokenizeVectorText(line, 8)))
  const signalTerms = findVectorSignalTerms(source)
  const generalTerms = tokenizeVectorText([phrases.join('\n'), sectionLines.join('\n'), source.slice(0, 900)].join('\n'), 30)
  return {
    titleTerms: uniqueVectorList(phraseTerms, 8),
    signalTerms: uniqueVectorList(signalTerms, 10),
    sectionTerms: uniqueVectorList(sectionTerms, 12),
    generalTerms: uniqueVectorList(generalTerms, 12)
  }
}

function isUsefulVectorQuery(query) {
  const terms = splitVectorQueryInput(query)[0]?.split(/\s+/).filter(Boolean) || []
  if (!terms.length) return false
  if (terms.length === 1 && ['游戏', '活动', '版本', '开场', '开头', '钩子', '卖点', '看点', '争议', '爆点', '攻略', '教程', '测评', '福利', '排名'].includes(terms[0])) return false
  return true
}

function pickVectorSearchQueries(manualQuery, intent, sourceText) {
  const manualQueries = splitVectorQueryInput(manualQuery)
  if (manualQueries.length) return uniqueVectorList(manualQueries, 3)

  const terms = buildVectorSearchTerms(sourceText)
  const entities = uniqueVectorList([].concat(intent?.entities || [], terms.titleTerms, terms.generalTerms), 10)
  const intentTerms = uniqueVectorList([].concat(intent?.intent_terms || []), 6)
  const signals = uniqueVectorList([].concat(terms.signalTerms, intentTerms, terms.sectionTerms), 12)
  const topicSignals = uniqueVectorList(signals.filter(term => !VECTOR_FRAME_TERMS.has(term)), 8)
  const frameSignals = uniqueVectorList(signals.filter(term => VECTOR_FRAME_TERMS.has(term)), 6)
  const primarySignals = topicSignals.length ? topicSignals : signals
  const candidates = []
  const addQuery = value => {
    const query = normalizeVectorQuery(value, 5)
    if (query && isUsefulVectorQuery(query)) candidates.push(query)
  }
  const addTerms = value => addQuery((value || []).filter(Boolean).join(' '))

  if (primarySignals.length >= 2) addTerms(primarySignals.slice(0, 5))
  addTerms(frameSignals.slice(0, 2).concat(topicSignals.slice(0, 3)))
  addTerms([entities[0], ...topicSignals.slice(0, 3), ...frameSignals.slice(0, 1)])
  addTerms(entities.slice(0, 2).concat(primarySignals.slice(0, 2)))
  ;(intent?.queries || []).forEach(query => addQuery(query))
  addTerms(terms.sectionTerms.slice(0, 5))
  addTerms(terms.titleTerms.slice(0, 4))
  addQuery(extractVectorSearchQuery(sourceText))

  return uniqueVectorList(candidates, 3)
}

function pickVectorFallbackQueries(intent, sourceText) {
  const terms = buildVectorSearchTerms(sourceText)
  const entities = uniqueVectorList([].concat(intent?.entities || [], terms.titleTerms, terms.generalTerms), 8)
  const signals = uniqueVectorList([].concat(terms.signalTerms, intent?.intent_terms || [], terms.sectionTerms), 12)
  const frameSignals = uniqueVectorList(signals.filter(term => VECTOR_FRAME_TERMS.has(term)), 6)
  const topicSignals = uniqueVectorList(signals.filter(term => !VECTOR_FRAME_TERMS.has(term)), 6)
  const candidates = []
  const addQuery = value => {
    const query = normalizeVectorQuery(value, 5)
    if (query && isUsefulVectorQuery(query)) candidates.push(query)
  }
  const addTerms = value => addQuery((value || []).filter(Boolean).join(' '))

  if (frameSignals.length >= 2) addTerms(frameSignals.slice(0, 4))
  if (frameSignals.length && topicSignals.length) addTerms(frameSignals.slice(0, 2).concat(topicSignals.slice(0, 2)))
  if (frameSignals.length && entities.length) addTerms([entities[0], ...frameSignals.slice(0, 3)])

  return uniqueVectorList(candidates, 2)
}

function extractVectorMetaTerms(text) {
  const out = ['抖音', '快手', '小红书', '视频号', 'B站', 'bilibili', 'douyin']
  String(text || '').split(/\r?\n/).forEach(line => {
    const match = line.trim().match(/^(账号|平台|发布时间|热度)\s*[：:]\s*(.+)$/)
    if (!match) return
    tokenizeVectorText(match[2], 4).forEach(term => out.push(term))
  })
  return uniqueVectorList(out, 12)
}

function normalizeVectorAiQueries(list = [], limit = 3, bannedTerms = []) {
  return uniqueVectorList((Array.isArray(list) ? list : [])
    .map(query => normalizeVectorQuery(String(query || '').replace(/["“”'‘’`]+/g, ' ').replace(/[，、,+]+/g, ' '), 5, bannedTerms))
    .filter(query => query && isUsefulVectorQuery(query)), limit)
}

function parseVectorSearchPlanReply(reply, sourceText = '') {
  const bannedTerms = extractVectorMetaTerms(sourceText)
  const raw = String(reply || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
  const jsonText = (raw.match(/\{[\s\S]*\}/) || [raw])[0]
  try {
    const data = JSON.parse(jsonText)
    return {
      primary: normalizeVectorAiQueries(data.primary_queries || data.primary || data.queries, 3, bannedTerms),
      fallback: normalizeVectorAiQueries(data.fallback_queries || data.fallback || data.expression_queries, 2, bannedTerms),
      reason: compactLine(data.reason || data.search_reason || '', 160)
    }
  } catch {
    const lines = raw.split(/\r?\n/)
      .map(line => line.replace(/^[-*\d.、\s]+/, '').trim())
      .filter(Boolean)
    return {
      primary: normalizeVectorAiQueries(lines.slice(0, 3), 3, bannedTerms),
      fallback: normalizeVectorAiQueries(lines.slice(3, 5), 2, bannedTerms),
      reason: ''
    }
  }
}

async function getVectorSearchPlanWithAI(analysisText, sourceText) {
  const analysis = String(analysisText || '').trim()
  const source = String(sourceText || '').trim()
  if (!analysis && !source) return null
  const bannedTerms = extractVectorMetaTerms([analysis, source].filter(Boolean).join('\n'))
  try {
    const d = await chatMinimax({
      model: 'gpt-5.5',
      system: '你只负责为本地向量素材库规划检索词。只输出 JSON，不写文案，不补充事实。',
      prompt: `请基于“AI拆解摘要”和“原始素材摘录”，判断这篇文案去本地转写库里应该搜什么。

目标：
- primary_queries：找题材/对象/核心事件相近的表达参考。
- fallback_queries：如果题材搜不到，再找开场方式/冲突表达/叙事包装相近的表达参考。

硬规则：
- 只输出 JSON：{"primary_queries":[],"fallback_queries":[],"reason":""}
- 每个 query 2-5 个短词，用空格分隔，例如“玩家 卡视角 游戏制作者”。
- primary_queries 不要只写“离谱/大瓜/爆点/游戏/素材/文案”等包装词或泛词。
- 不要输出账号、平台、发布时间、热度、标题、转写原文、链接等元信息。
- 以下是本次禁用的元信息词，绝对不要输出：${bannedTerms.join('、') || '无'}
- 不要输出整句长句，尽量抽成可检索的名词/动作/冲突。
- 检索词必须来自材料中的真实信息，不能发明新事实。

AI拆解摘要：
${analysis.substring(0, 2200)}

原始素材摘录：
${source.substring(0, 2200)}`
    })
    const plan = parseVectorSearchPlanReply(d.reply || d.response || d.content || '', [analysis, source].filter(Boolean).join('\n'))
    if (!plan.primary.length && !plan.fallback.length) return null
    return plan
  } catch {
    return null
  }
}

function workflowSearchPlanConfig(mode) {
  if (mode === 'platform') {
    return {
      label: 'B站候选视频搜索',
      primaryLimit: 3,
      fallbackLimit: 2,
      termLimit: 4,
      goal: '为 B站 搜索相近题材/相近素材的视频候选，优先生成像用户会在 B站 搜的标题关键词。',
      primaryDesc: 'primary_queries 放最可能搜到同题材视频的主体词，建议“游戏/产品 + 角色/战队/选手/版本/事件”。',
      fallbackDesc: 'fallback_queries 放同领域但更宽一点的搜索词。'
    }
  }
  return {
    label: '背景事实搜索',
    primaryLimit: 4,
    fallbackLimit: 2,
    termLimit: 5,
    goal: '为背景资料/事实核查搜索提炼关键词，优先找到主体、事件、版本、赛事、角色、战队或选手的准确信息。',
    primaryDesc: 'primary_queries 放事实背景搜索最该搜的主体词，不要只放情绪词或包装词。',
    fallbackDesc: 'fallback_queries 放可扩大检索面的备用主体词。'
  }
}

function coerceWorkflowPlanList(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    return value.split(/[\n/|；;]+/).map(item => item.trim()).filter(Boolean)
  }
  return []
}

function isUsefulWorkflowQuery(query, mode = 'hot') {
  if (!isUsefulVectorQuery(query)) return false
  if (mode === 'hot' && isWeakHotSearchQuery(query)) return false
  const terms = splitVectorQueryInput(query)[0]?.split(/\s+/).filter(Boolean) || []
  if (!terms.length) return false
  const generic = new Set(['游戏', '活动', '版本', '赛事', '战队', '选手', '角色', '背景', '资料', '视频', '素材', '文案'])
  if (terms.every(term => generic.has(term) || VECTOR_FRAME_TERMS.has(term))) return false
  return true
}

function normalizeWorkflowAiQueries(list = [], mode = 'hot', limit = 3, bannedTerms = []) {
  const cfg = workflowSearchPlanConfig(mode)
  return uniqueVectorList(coerceWorkflowPlanList(list)
    .map(query => normalizeVectorQuery(String(query || '').replace(/["“”'‘’`]+/g, ' ').replace(/[，、,+]+/g, ' '), cfg.termLimit, bannedTerms))
    .filter(query => query && isUsefulWorkflowQuery(query, mode)), limit)
}

function parseWorkflowSearchPlanReply(reply, sourceText = '', mode = 'hot') {
  const cfg = workflowSearchPlanConfig(mode)
  const bannedTerms = extractVectorMetaTerms(sourceText)
  const raw = String(reply || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
  const jsonText = (raw.match(/\{[\s\S]*\}/) || [raw])[0]
  try {
    const data = JSON.parse(jsonText)
    return {
      primary: normalizeWorkflowAiQueries(data.primary_queries || data.primary || data.queries, mode, cfg.primaryLimit, bannedTerms),
      fallback: normalizeWorkflowAiQueries(data.fallback_queries || data.fallback || data.backup_queries, mode, cfg.fallbackLimit, bannedTerms),
      reason: compactLine(data.reason || data.search_reason || '', 180)
    }
  } catch {
    const lines = raw.split(/\r?\n/)
      .map(line => line.replace(/^[-*\d.、\s]+/, '').trim())
      .filter(Boolean)
    return {
      primary: normalizeWorkflowAiQueries(lines.slice(0, cfg.primaryLimit), mode, cfg.primaryLimit, bannedTerms),
      fallback: normalizeWorkflowAiQueries(lines.slice(cfg.primaryLimit, cfg.primaryLimit + cfg.fallbackLimit), mode, cfg.fallbackLimit, bannedTerms),
      reason: ''
    }
  }
}

async function getWorkflowSearchPlanWithAI(analysisText, sourceText, mode = 'hot') {
  const analysis = String(analysisText || '').trim()
  const source = String(sourceText || '').trim()
  if (!analysis && !source) return null
  const cfg = workflowSearchPlanConfig(mode)
  const bannedTerms = extractVectorMetaTerms([analysis, source].filter(Boolean).join('\n'))
  try {
    const d = await chatMinimax({
      model: 'gpt-5.5',
      system: '你只负责为内容工作流规划搜索词。只输出 JSON，不写文案，不补充事实。',
      prompt: `请基于“AI拆解摘要”和“原始素材摘录”，为【${cfg.label}】规划搜索词。

目标：
- ${cfg.goal}
- ${cfg.primaryDesc}
- ${cfg.fallbackDesc}

主体优先级：
1. 产品/游戏/活动/赛事名。
2. 角色名、战队名、队伍名、选手名、主播名、人物名。
3. 版本号、代号、英文缩写和字母数字标识，例如 V10、CPTV10、T1、EDG、LT、HAN、RRQ；如果材料里出现，必须原样保留，不能翻译、扩写或丢弃。
4. 关键事件/冲突/卖点，只作为主体后的辅助词。

硬规则：
- 只输出 JSON：{"primary_queries":[],"fallback_queries":[],"reason":""}
- 每个 query 2-${cfg.termLimit} 个短词，用空格分隔。
- 不要输出账号、平台、发布时间、热度、链接、标题标签、转写原文等元信息。
- 不要只输出“离谱/大瓜/爆点/游戏/素材/文案/背景/搜索”等包装词或泛词。
- 以下是本次禁用的元信息词，绝对不要输出：${bannedTerms.join('、') || '无'}
- 检索词必须来自材料中的真实信息，不能发明新主体。

AI拆解摘要：
${analysis.substring(0, 2200)}

原始素材摘录：
${source.substring(0, 2200)}`
    })
    const plan = parseWorkflowSearchPlanReply(d.reply || d.response || d.content || '', [analysis, source].filter(Boolean).join('\n'), mode)
    if (!plan.primary.length && !plan.fallback.length) return null
    return plan
  } catch {
    return null
  }
}

async function searchVectorQuerySet(queries = [], scope = '主题匹配') {
  const errors = []
  const batches = await Promise.all((queries || []).map(async query => {
    try {
      const d = await searchVector({ query, limit: 5, min_score: 4 })
      return (d.results || []).map(item => ({
        ...item,
        vector_query: query,
        vector_match_scope: scope
      }))
    } catch (e) {
      errors.push(e.message || String(e))
      return []
    }
  }))
  return { results: mergeVectorResults(batches.flat()), errors }
}

function mergeVectorResults(results = []) {
  const map = new Map()
  ;(results || []).forEach(item => {
    const text = vectorResultText(item)
    if (!text) return
    const matched = item?.matched_tokens
    if (matched !== undefined && Number(matched) <= 0) return
    const key = item?.id || item?.link || item?.url || vectorTermKey(text.slice(0, 180))
    if (!key) return
    const previous = map.get(key)
    if (!previous || Number(item?.score || 0) > Number(previous?.score || 0)) map.set(key, item)
  })
  return Array.from(map.values()).sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
}

function filterVectorResults(results = [], limit = 2) {
  return (results || [])
    .filter(r => String(r?.text || r?.content || r?.summary || r?.snippet || '').trim())
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, limit)
}

function extractPlatformKeywords(text) {
  const source = String(text || '')
  const words = (source.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}/g) || [])
    .filter(w => !['http', 'https', 'www', 'com', 'video', 'bilibili', 'douyin'].includes(w.toLowerCase()))
  const picked = []
  for (const w of words) {
    if (!picked.includes(w)) picked.push(w)
    if (picked.length >= 4) break
  }
  return picked.join(' ')
}

const HOT_QUERY_NOISE = new Set([
  '这个', '一个', '不是', '但是', '因为', '所以', '然后', '如果', '我们', '他们', '大家',
  '视频', '内容', '素材', '文案', '分析', '结构', '切入点', '切入', '框架', '背景', '搜索',
  '原视频', '一句话', '概括', '主线', '风险', '提醒', '可能', '可以', '需要',
  '结果', '枪法', '熟练度', '超', '很强', '顶级', '操作', '水平', '能力', '表现',
  '选题', '结尾', '方案', '论据', '观点', '叙事', '节奏', '名场面', '弹幕', '粉丝',
  '解说', '采访', '金句', '梗', '传播', '统治力', '压迫感', '舞台中心', '国内联赛',
  '世界冠军', '全球冠军', '冠军', '奖杯', 'MVP', 'mvp', '真C', '康神', '别尬黑',
  '小道消息', '混迹娱乐圈', '鸡头班', '直播间', '开播', '那个K', '凯哥',
  '穿搭', '加油', 'let', 'lets', 'go', '明星嘉宾', '随便玩玩', '划水',
  '凑个数', '走个流程', '高强度博弈', '有点东西', '高光', '明场面',
  '把把乱C', '收割全场', '路过看看', '看热闹', '你真会啊', '达瓦',
  'ok', 're', 'gas'
])

const HOT_QUERY_ATTRIBUTE_TERMS = new Set([
  '争议', '争议判罚', '判罚争议', '判罚', '黑哨', '误判', '红牌', '越位', '犯规',
  '粗野动作', '粗野', '动作', '冲突', '争端', '质疑'
])

function cleanHotQueryToken(value) {
  return String(value || '')
    .replace(/^(关于|围绕|针对|这期|本期|这条|这个|一个|就是|讲的是|和|与|跟|以及|还有|的)+/g, '')
    .replace(/(的|了|和|与|跟|之间|相关|事件|话题|内容|视频|素材|画面|镜头|文案|传闻|绯闻)+$/g, '')
    .trim()
}

function isHotQueryNoise(value) {
  const word = cleanHotQueryToken(value)
  if (!word || word.length < 2 || /^\d+$/.test(word)) return true
  for (const item of HOT_QUERY_NOISE) {
    if (word === item || word.includes(item)) return true
  }
  return false
}

function isHotQueryAttributeOnly(value) {
  const tokens = String(value || '').match(/[\u4e00-\u9fa5]{1,8}|[A-Za-z][A-Za-z0-9_-]{1,30}/g) || []
  const meaningful = tokens.map(cleanHotQueryToken).filter(Boolean)
  if (!meaningful.length) return true
  return meaningful.every(token => HOT_QUERY_ATTRIBUTE_TERMS.has(token))
}

function normalizeHotEntity(value) {
  const word = cleanHotQueryToken(value)
  if (/^faker$/i.test(word)) return 'Faker'
  if (/^zmjjkk$/i.test(word) || word === '康康' || word === '郑永康') return 'ZmjjKK'
  if (/^edg$/i.test(word)) return 'EDG'
  if (/^valorant$/i.test(word) || word === '瓦罗兰特' || word === '无畏区' || word === '达瓦') return '无畏契约'
  if (word === '小凯' || word === '凯哥') return '王俊凯'
  return word
}

function uniqueHotTokens(tokens, limit = 4) {
  const out = []
  const seen = new Set()
  ;(tokens || []).forEach(token => {
    const word = normalizeHotEntity(token)
    const key = word.toLowerCase()
    if (!word || isHotQueryNoise(word) || seen.has(key)) return
    seen.add(key)
    out.push(word)
  })
  return out.slice(0, limit)
}

function extractKnownHotEntities(text) {
  const source = String(text || '')
  const found = []
  if (/zmjjkk|康康|郑永康/i.test(source)) found.push('ZmjjKK')
  if (/\bedg\b/i.test(source)) found.push('EDG')
  if (/无畏区|无畏契约|瓦罗兰特|valorant|达瓦/i.test(source)) found.push('无畏契约')
  if (/王俊凯|小凯|凯哥/i.test(source)) found.push('王俊凯')
  if (/faker|飞科|李相赫/i.test(source)) found.push('Faker')
  if (/karina|柳智敏/i.test(source)) found.push(/karina/i.test(source) ? 'Karina' : '柳智敏')
  if (/aespa/i.test(source)) found.push('aespa')
  if (/世界杯|world\s*cup/i.test(source)) found.push('世界杯')
  ;['韩国', '意大利', '日本', '西班牙', '葡萄牙', '德国', '巴西', '法国', '英格兰', '阿根廷', '中国', '国足'].forEach(name => {
    if (source.includes(name)) found.push(name)
  })
  ;['托蒂', '托马西', '莫雷诺', '安贞焕', '马尔蒂尼', '布冯', '皮耶罗'].forEach(name => {
    if (source.includes(name)) found.push(name)
  })
  return uniqueHotTokens(found, 4)
}

function isWeakHotSearchQuery(query) {
  const tokens = String(query || '').match(/[\u4e00-\u9fa5]{1,8}|[A-Za-z][A-Za-z0-9_-]{1,30}/g) || []
  const meaningful = uniqueHotTokens(tokens, 4)
  if (!meaningful.length) return true
  if (isHotQueryAttributeOnly(query)) return true
  if (meaningful.length === 1 && meaningful[0].length <= 2 && !/[A-Z]/.test(meaningful[0])) return true
  return false
}

function extractStructuredHotSearchQuery(text) {
  const source = String(text || '')
  const year = (source.match(/\b(19\d{2}|20\d{2})\s*年?/) || [])[1] || ''
  const event = /世界杯|world\s*cup/i.test(source) ? '世界杯' : ''
  const teams = ['韩国', '意大利', '日本', '西班牙', '葡萄牙', '德国', '巴西', '法国', '英格兰', '阿根廷', '中国', '国足']
    .filter(name => source.includes(name))
  const people = ['托蒂', '托马西', '莫雷诺', '安贞焕', '马尔蒂尼', '布冯', '皮耶罗']
    .filter(name => source.includes(name))
  const attributes = ['争议判罚', '黑哨', '红牌', '越位', '粗野动作']
    .filter(name => source.includes(name.replace('争议', '')) || source.includes(name))

  if (year && event && teams.length >= 2) {
    return uniqueHotTokens([`${year}${event}`, ...teams.slice(0, 2), ...people.slice(0, 1), ...attributes.slice(0, 1)], 5).join(' ')
  }
  if (event && teams.length >= 2) {
    return uniqueHotTokens([event, ...teams.slice(0, 2), ...people.slice(0, 1), ...attributes.slice(0, 1)], 5).join(' ')
  }
  if (year && event && (teams.length || people.length)) {
    return uniqueHotTokens([`${year}${event}`, ...teams.slice(0, 1), ...people.slice(0, 2), ...attributes.slice(0, 1)], 5).join(' ')
  }
  return ''
}

function buildHotQueryFromIntent(intent, sourceText) {
  const entities = uniqueHotTokens([...(intent?.entities || []), ...extractKnownHotEntities(sourceText)], 3)
  const intentTerms = uniqueHotTokens(intent?.intent_terms || [], 1)
  if (entities.length) return entities.concat(intentTerms).slice(0, 4).join(' ')
  const candidates = [intent?.query, ...(intent?.queries || [])]
  return String(candidates.find(item => item && !isWeakHotSearchQuery(item)) || '').trim()
}

function pickHotSearchQuery(savedQuery, intent, sourceText) {
  const candidates = [
    extractStructuredHotSearchQuery(sourceText),
    savedQuery,
    buildHotQueryFromIntent(intent, sourceText),
    pickSubjectFallbackQuery(sourceText, 4),
    extractHotSearchQuerySmart(sourceText),
    extractHotSearchQuery(sourceText)
  ]
  return String(candidates.find(item => item && !isWeakHotSearchQuery(item)) || '').trim()
}

function extractHotSearchQuery(text) {
  const source = String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[，。！？；：、,.!?;:()[\]【】"'“”]/g, ' ')
  const noise = new Set([
    '这个', '一个', '不是', '但是', '因为', '所以', '然后', '如果', '我们', '他们', '大家',
    '视频', '内容', '素材', '文案', '分析', '结构', '切入点', '框架', '背景', '搜索',
    '原视频', '一句话', '概括', '主线', '风险', '提醒', '可能', '可以', '需要',
    '电竞选手', '职业选手', '偶像', '之间', '公众', '讨论', '恋情传闻', '传闻'
  ])
  const cleanKeyword = (value) => String(value || '')
    .replace(/^(关于|围绕|针对|这期|本期|这条|这个)+/g, '')
    .replace(/(的|了|和|与|跟|之间|相关|事件|话题|内容|视频)+$/g, '')
    .trim()

  const pair = source.match(/\b([A-Z][A-Za-z0-9_-]{2,})\b\s*(?:和|与|跟|、)\s*([\u4e00-\u9fa5]{2,5})/)
  if (pair) {
    const left = cleanKeyword(pair[1])
    const right = cleanKeyword(pair[2])
    if (left && right && !noise.has(right)) return `${left} ${right}`
  }

  const candidates = []
  const add = (value, score = 1) => {
    const word = cleanKeyword(value)
    if (!word || word.length < 2 || word.length > 24) return
    if (noise.has(word)) return
    if (/^\d+$/.test(word)) return
    const existing = candidates.find(item => item.word.toLowerCase() === word.toLowerCase())
    if (existing) existing.score += score
    else candidates.push({ word, score })
  }

  ;(source.match(/\b[A-Z][A-Za-z0-9_-]{2,}\b/g) || []).forEach(word => add(word, 12))
  ;(source.match(/《([^》]{2,24})》/g) || []).forEach(word => add(word.replace(/[《》]/g, ''), 10))
  ;(source.match(/#[\u4e00-\u9fa5A-Za-z0-9_]{2,24}/g) || []).forEach(word => add(word.slice(1), 8))
  ;(source.match(/[\u4e00-\u9fa5]{2,4}(?=(和|与|跟|、)[\u4e00-\u9fa5]{2,4})/g) || []).forEach(word => add(word, 8))
  ;(source.match(/(?<=(和|与|跟|、))[\u4e00-\u9fa5]{2,4}/g) || []).forEach(word => add(word, 8))
  ;(source.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,18}(?=恋情|绯闻|联动|官宣|回应|道歉|翻车|争议|热搜|比赛|冠军|退役|复出)/g) || []).forEach(word => add(word, 7))
  ;(source.match(/[\u4e00-\u9fa5]{2,5}/g) || []).forEach(word => add(word, 1))

  return candidates
    .sort((a, b) => b.score - a.score || a.word.length - b.word.length)
    .slice(0, 4)
    .map(item => item.word)
    .join(' ')
}

function extractHotSearchQuerySmart(text) {
  const raw = String(text || '')
  const source = raw
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[，。！？；：、,.!?;:()[\]【】"'“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const noise = new Set([
    '\u8fd9\u671f', '\u672c\u671f', '\u8fd9\u6761', '\u8fd9\u4e2a', '\u4e00\u4e2a', '\u5c31\u662f', '\u8bb2\u7684\u662f', '\u5173\u4e8e', '\u56f4\u7ed5',
    '\u89c6\u9891', '\u5185\u5bb9', '\u7d20\u6750', '\u6587\u6848', '\u5206\u6790', '\u7ed3\u6784', '\u5207\u5165\u70b9', '\u6846\u67b6', '\u80cc\u666f', '\u641c\u7d22',
    '\u539f\u89c6\u9891', '\u4e00\u53e5\u8bdd', '\u6982\u62ec', '\u4e3b\u7ebf', '\u98ce\u9669', '\u63d0\u9192', '\u53ef\u80fd', '\u53ef\u4ee5', '\u9700\u8981',
    '\u7535\u7ade\u9009\u624b', '\u804c\u4e1a\u9009\u624b', '\u9009\u624b', '\u5076\u50cf', '\u660e\u661f', '\u4e4b\u95f4', '\u516c\u4f17', '\u8ba8\u8bba',
    '\u604b\u60c5\u4f20\u95fb', '\u4f20\u95fb', '\u7eef\u95fb', '\u4e8b\u4ef6', '\u8bdd\u9898', '\u70ed\u70b9', '\u7f51\u53cb', '\u89c2\u70b9'
  ])

  const cleanToken = (value) => String(value || '')
    .replace(/(?:\u7684|\u56e0|\u88ab|\u5c06|\u5728|\u4e0a|\u548c|\u4e0e|\u8ddf).+$/g, '')
    .replace(/^(?:\u8fd9\u671f|\u672c\u671f|\u8fd9\u6761|\u8fd9\u4e2a|\u4e00\u4e2a|\u5173\u4e8e|\u56f4\u7ed5|\u9488\u5bf9|\u8bb2\u7684\u662f|\u5c31\u662f|\u548c|\u4e0e|\u8ddf|\u4ee5\u53ca|\u8fd8\u6709|\u7684)+/g, '')
    .replace(/(?:\u7684|\u4e86|\u548c|\u4e0e|\u8ddf|\u4e4b\u95f4|\u76f8\u5173|\u4e8b\u4ef6|\u8bdd\u9898|\u5185\u5bb9|\u89c6\u9891|\u7d20\u6750|\u604b\u60c5\u4f20\u95fb|\u4f20\u95fb|\u7eef\u95fb)+$/g, '')
    .trim()

  const isUseful = (value) => {
    const word = cleanToken(value)
    if (!word || word.length < 2 || word.length > 24) return false
    if (/^\d+$/.test(word)) return false
    if (noise.has(word)) return false
    for (const item of noise) {
      if (word === item || word.includes(item)) return false
    }
    return true
  }

  const normalizeEnglish = (word) => {
    const value = cleanToken(word)
    if (!value) return ''
    if (/^faker$/i.test(value)) return 'Faker'
    return value
  }

  const pickPair = (left, right) => {
    const a = /^[A-Za-z][A-Za-z0-9_-]{1,30}$/.test(left) ? normalizeEnglish(left) : cleanToken(left)
    const b = /^[A-Za-z][A-Za-z0-9_-]{1,30}$/.test(right) ? normalizeEnglish(right) : cleanToken(right)
    if (!isUseful(a) || !isUseful(b)) return ''
    return `${a} ${b}`
  }

  const connectors = '(?:\\s*(?:\\u548c|\\u4e0e|\\u8ddf|\\u4ee5\\u53ca|\\u8fd8\\u6709|and|&)\\s*)'
  const enZhPair = new RegExp('\\b([A-Za-z][A-Za-z0-9_-]{1,30})\\b' + connectors + '([\\u4e00-\\u9fa5]{2,5})', 'i')
  const zhEnPair = new RegExp('([\\u4e00-\\u9fa5]{2,5})' + connectors + '\\b([A-Za-z][A-Za-z0-9_-]{1,30})\\b', 'i')
  const zhZhPair = new RegExp('([\\u4e00-\\u9fa5]{2,4})' + connectors + '([\\u4e00-\\u9fa5]{2,4})', 'i')
  const directPair = source.match(enZhPair) || source.match(zhEnPair) || source.match(zhZhPair)
  if (directPair) {
    const pair = pickPair(directPair[1], directPair[2])
    if (pair) return pair
  }

  const lead = source.slice(0, 260)
  const englishNames = (lead.match(/\b[A-Za-z][A-Za-z0-9_-]{1,30}\b/g) || [])
    .map(normalizeEnglish)
    .filter(isUseful)
  const chineseNames = (lead.match(/[\u4e00-\u9fa5]{2,5}/g) || [])
    .map(cleanToken)
    .filter(isUseful)
    .filter(word => !/[\u8fd9\u662f\u7684\u4e86\u4e00\u5728\u6709\u548c\u4e0e]/.test(word.slice(0, 1)))
  if (englishNames.length && chineseNames.length) {
    return [englishNames[0], chineseNames[0]].join(' ')
  }

  const candidates = []
  const add = (value, score = 1) => {
    const word = /^[A-Za-z][A-Za-z0-9_-]{1,30}$/.test(String(value || '')) ? normalizeEnglish(value) : cleanToken(value)
    if (!isUseful(word)) return
    const existing = candidates.find(item => item.word.toLowerCase() === word.toLowerCase())
    if (existing) existing.score += score
    else candidates.push({ word, score })
  }

  ;(source.match(/\b[A-Za-z][A-Za-z0-9_-]{1,30}\b/g) || []).forEach(word => add(word, 12))
  ;(source.match(/《([^》]{2,24})》/g) || []).forEach(word => add(word.replace(/[《》]/g, ''), 10))
  ;(source.match(/#[\u4e00-\u9fa5A-Za-z0-9_]{2,24}/g) || []).forEach(word => add(word.slice(1), 8))
  ;(source.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,18}(?=\u604b\u60c5|\u7eef\u95fb|\u4f20\u95fb|\u8054\u52a8|\u5b98\u5ba3|\u56de\u5e94|\u9053\u6b49|\u7ffb\u8f66|\u4e89\u8bae|\u70ed\u641c|\u6bd4\u8d5b|\u51a0\u519b|\u9000\u5f79|\u590d\u51fa)/g) || []).forEach(word => add(word, 7))
  ;(source.match(/[\u4e00-\u9fa5]{2,5}/g) || []).forEach(word => add(word, 1))

  const picked = []
  candidates
    .sort((a, b) => b.score - a.score || a.word.length - b.word.length)
    .forEach(item => {
      if (picked.length >= 3) return
      if (picked.some(word => word.includes(item.word) || item.word.includes(word))) return
      picked.push(item.word)
    })
  return picked.join(' ')
}

function togglePlatform(n, platform) {
  if (!n?.data) return
  const set = new Set(n.data.platforms || [])
  if (set.has(platform)) set.delete(platform)
  else set.add(platform)
  n.data.platforms = Array.from(set)
}

function extractPlatformSearchQuery(text) {
  const source = String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
  const words = (source.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}/g) || [])
    .filter(w => !['??', '??', '??', '??', '??', '??', '??', '??', '??', '??'].includes(w))
  const picked = []
  for (const word of words) {
    if (!picked.includes(word)) picked.push(word)
    if (picked.length >= 4) break
  }
  return picked.join(' ')
}



async function getSearchIntentQuery(text, mode) {
  try {
    const d = await extractSearchIntent({
      text: String(text || '').substring(0, 5000),
      mode
    })
    return {
      query: String(d.query || (Array.isArray(d.queries) ? d.queries[0] : '') || '').trim(),
      queries: Array.isArray(d.queries) ? d.queries : [],
      entities: Array.isArray(d.entities) ? d.entities : [],
      exclude_terms: Array.isArray(d.exclude_terms) ? d.exclude_terms : [],
      intent_terms: Array.isArray(d.intent_terms) ? d.intent_terms : []
    }
  } catch (e) {
    return { query: '', queries: [], entities: [], exclude_terms: [], intent_terms: [] }
  }
}



function filterHotResultsBySourceText(results = [], sourceText = '', query = '') {
  const tokens = new Set((`${sourceText} ${query}`.match(/[\u4e00-\u9fa5]{2,6}|[A-Za-z][A-Za-z0-9_-]{2,30}/g) || [])
    .map(token => token.toLowerCase())
    .filter(token => !['背景搜索', '结构拆解', '可参考来源', '搜索结果', '视频内容', '文案'].includes(token)))
  const scored = (results || []).map(item => {
    const text = `${item.title || ''} ${item.content || item.summary || item.snippet || item.text || ''}`.toLowerCase()
    let score = 0
    tokens.forEach(token => {
      if (text.includes(token)) score += /[a-z]/i.test(token) ? 3 : 2
    })
    if (String(item.content_status || '').toLowerCase().includes('snippet')) score -= 2
    if (!String(item.content || item.summary || '').trim()) score -= 1
    return { item, score }
  })
  const kept = scored.filter(row => row.score >= 2).sort((a, b) => b.score - a.score).slice(0, 4).map(row => row.item)
  return kept.length ? kept : scored.sort((a, b) => b.score - a.score).slice(0, 2).map(row => row.item)
}


function normalizeJsonReply(reply) {
  const text = String(reply || '').trim()
  const match = text.match(/\{[\s\S]*\}/)
  const raw = match ? match[0] : text
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return text
  }
}

function buildAnalyzePrompt(txt) {
  return `你是短视频文案拆解师。请把素材拆成一份方便人阅读的简洁拆解，不要做“可替换切入点”，替换和改写留到后续创意步骤。

输出要求：
- 用 Markdown，不要 JSON。
- 总长度控制在 800 字以内。
- 只保留对创作有用的信息，别把转写原文逐段复述。
- 论据最多 5 条，结构最多 5 步。
- 如果有数据或史实不确定，只在“风险提醒”里简短提示。

格式：
## 素材一句话
一句话概括这条素材讲什么。

## 原切入点
原视频是从哪个反差、悬念或问题切入的。

## 主线结构
1. ...
2. ...

## 关键论据
- ...

## 结尾方式
说明原素材如何收束。

## 风险提醒
- 可选，最多 3 条。

原始素材：
${String(txt || '').substring(0, 7000)}`
  return `你是短视频文案拆解师。请把素材拆成后续创作能直接复用的三件套：切入点、框架、论据。

只返回 JSON，不要 markdown，不要解释。字段保持简洁，缺失处用空字符串或空数组。

{
  "素材一句话": "",
  "切入点": {
    "原切入点": "",
    "为什么这个切入点成立": "",
    "可替换切入点": []
  },
  "框架": {
    "结构顺序": "",
    "每一步作用": []
  },
  "论据": [
    { "内容": "", "作用": "" }
  ],
  "结尾": "",
  "可复用写法": ""
}

原始素材：
${String(txt || '').substring(0, 7000)}`
}

function buildIdeaPrompt(rep) {
  return `你是短视频选题策划。基于上游拆解出的切入点、框架、论据，给出 3 个创意方向。

不要直接写完整文案。每条都必须包含：切入点、框架、论据。

输出格式严格为 3 行，每行用竖线分隔：
创意标题 | 切入点 | 框架 | 论据 | 结尾

要求：
1. 切入点要具体，不要写空泛概念。
2. 框架要能看出展开顺序。
3. 论据要说明这条创意靠什么内容支撑。

上游拆解/汇总：
${String(rep || '').substring(0, 7000)}`
}

function buildCopyPrompt(rep, idea) {
  return buildCopyPromptV2(rep, idea, DEFAULT_WORDS)
}

function buildCopyPromptV2(rep, idea, words = DEFAULT_WORDS, styleRef = null) {
  const targetWords = wordTargetLabel(words)
  const styleBlock = styleRef?.style ? `

引用风格卡：
${String(styleRef.style || '').substring(0, 5000)}

风格使用规则：
1. 参考这张风格卡的内容定位、开头方式、句式节奏、常用话术和结尾方式。
2. 不要照抄样本文案，不要强行复刻账号人设口头禅。
3. 事实、观点和论据必须以上游拆解/汇总为准，不要为了贴风格而编造内容。` : ''
  return `你是短视频成稿文案。请根据上游拆解和用户选中的创意方向写一版中文口播文案。

必须遵守：
1. 沿用选中创意里的切入点、框架、论据，不要另起炉灶。
2. 字数目标：${targetWords}，尽量贴近即可，不要为了凑字数灌水。
3. 只输出正文，不要标题、不要解释、不要 JSON。
4. 语言要像真人口播，短句、递进、能听懂。
5. 素材不足时谨慎表达，不要编造事实。

上游拆解/汇总：
${String(rep || '').substring(0, 7000)}

用户确认的创意方向：
${String(idea || '').substring(0, 2000)}${styleBlock}`
}

function buildIdeaCardCopyPrompt(sourceText, reportText, idea, words = DEFAULT_WORDS, styleRef = null) {
  const targetWords = wordTargetLabel(words)
  const styleBlock = styleRef?.style ? `

引用风格卡：
${String(styleRef.style || '').substring(0, 4200)}

风格要求：
参考这张风格卡的开头方式、句式节奏、表达密度和结尾习惯，但不要照抄样本文案。事实和观点必须以原文和创意卡为准。` : ''
  return `你是短视频口播文案写手。请基于用户已经确认的创意卡，直接写一版中文成稿。

要求：
1. 主要依据“转写原文/输入原文”，保留原文里的具体事件、梗、语气和可用细节。
2. 字数目标：${targetWords}，尽量贴近即可，不要为了凑字数灌水。
3. 只输出正文，不要标题、解释、JSON 或分点说明。
4. 语言要像真人口播，短句、递进、清楚、有节奏。
5. 创意卡只决定切入角度和展开方向，不要为了贴创意卡改写事实。
6. 汇总报告/背景搜索只用于事实校验和背景补充；如果与原文冲突，以原文为主，并谨慎表达。
7. 开头前 2-3 句必须有明确钩子：可以是反差、疑问、离谱点或最有传播性的事件，不要从背景介绍慢慢铺。
8. 正文按“钩子 → 事件发生了什么 → 最好看的细节/梗 → 为什么值得说 → 回扣结尾”自然推进，但不要写小标题。
9. 优先使用原文里可复用的称呼、梗和口播语气；清理明显转写错误和无意义口头残词。
10. 避免通用模板腔，比如“值得一提的是”“总的来说”“引发热议”“这背后反映了”等空泛表达。
11. 材料不足时谨慎表达，不要编造事实。

转写原文/输入原文（主依据）：
${String(sourceText || '').substring(0, 9000)}

汇总报告/事实校验（辅助）：
${String(reportText || '').substring(0, 5000)}

用户确认的创意卡：
${String(idea || '').substring(0, 2200)}${styleBlock}`
}

function buildCopySelfCheckPrompt(draft, sourceText, reportText, idea, words = DEFAULT_WORDS) {
  const targetWords = wordTargetLabel(words)
  return `你是短视频文案质检和修稿编辑。请基于原文、汇总报告和创意卡，对下面这版口播文案做一次自检后直接输出修订后的最终正文。

修稿目标：
1. 保留原文核心事件、具体梗、人物关系和语气，不要写成泛泛评论。
2. 删除或改弱没有依据的判断，不要编造事实。
3. 背景信息只做事实校验和必要补充，不能抢走原文主线。
4. 如果草稿偏离创意卡的切入角度，请拉回创意卡。
5. 检查开头是否足够快：前 2-3 句要直接给出反差、悬念或最有传播性的事件。
6. 删除模板腔和总结腔，让它更像短视频口播，而不是新闻摘要或读后感。
7. 保留自然口语的节奏，但清理明显转写错误、重复句和无意义口头残词。
8. 字数目标仍为 ${targetWords}，尽量贴近即可，不要为了凑字数灌水。
9. 只输出修订后的正文，不要解释修改过程，不要标题，不要分点。

转写原文/输入原文：
${String(sourceText || '').substring(0, 9000)}

汇总报告/事实校验：
${String(reportText || '').substring(0, 5000)}

用户确认的创意卡：
${String(idea || '').substring(0, 2200)}

待修订草稿：
${String(draft || '').substring(0, 6000)}`
}



const detailContent = computed({
  get() {
    return detailText(selectedNode.value)
  },
  set(value) {
    const n = selectedNode.value
    if (!n) return
    if (n.type === 'transcribe') n.data.text = value
    else if (n.type === 'analyze') n.data.r = value
    else if (n.type === 'sum') n.data.txt = value
    else if (n.type === 'gen') n.data.out = value
    else if (n.type === 'ideaCard') {
      if (n.data.out) n.data.out = value
      else applyIdeaCardDetailRevision(n, value)
    }
    else if (n.type === 'idea') {
      n.data.list = String(value || '').split('\n').map(x => x.trim()).filter(Boolean)
      if (n.data.sel >= n.data.list.length) n.data.sel = -1
    }
  }
})

function stripIdeaCardDisplayText(value) {
  let text = String(value || '').trim()
  text = text
    .replace(/^\s*#{1,3}\s*已选创意\s*/gmi, '')
    .replace(/^\s*#{1,4}\s*\d+[.、)]?\s*/gmi, '')
    .replace(/^\s*(?:已选创意|创意方向)\s*[：:]?\s*/gmi, '')
    .trim()
  const seen = new Set()
  const lines = text.split(/\r?\n/).filter(line => {
    const key = line.trim()
    if (!key) return true
    if (/^#{1,3}\s*已选创意/.test(key)) return false
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function applyIdeaCardDetailRevision(card, value) {
  const text = stripIdeaCardDisplayText(value)
  const parsed = parseIdeaCardDetailText(text, 0)
  card.data.text = parsed.text || text || ''
  card.data.title = parsed.title || card.data.title || ''
  card.data.entry = parsed.entry || card.data.entry || ''
  card.data.framework = parsed.framework || card.data.framework || ''
  card.data.ending = parsed.ending || card.data.ending || ''
}

function openOutput(n) {
  const text = outputText(n)
  if (!text) return
  outputViewer.show = true
  outputViewer.title = n.label || typeCode(n.type)
  outputViewer.kicker = typeCode(n.type)
  outputViewer.text = text
}

function closeOutput() {
  outputViewer.show = false
}

async function copyOutput() {
  try {
    await navigator.clipboard.writeText(outputViewer.text || '')
  } catch(e) {}
}

function closeDetail() {
  sel.value = null
}

async function copyDetail() {
  try {
    await navigator.clipboard.writeText(detailContent.value || '')
  } catch(e) {}
}

async function saveDetailToVector() {
  const n = selectedNode.value
  const raw = outputViewer.show ? (outputViewer.text || '') : (detailContent.value || '')
  const text = cleanTranscriptText(raw) || raw.trim()
  if (!n || !text) return
  n.data.s = '存入向量库中...'
  try {
    const input = inputData(n)
    const source = input.url || n.data.url || ''
    const result = await addVectorItem('wenan', {
      text,
      source,
      type: n.type,
      scene: typeCode(n.type),
      account: input.idea || ''
    })
    n.data.s = result.success ? '向量库已保存' : (result.error || '向量库保存失败')
  } catch (e) {
    n.data.s = '向量库保存失败: ' + e.message
  }
}

function detailSelection() {
  const active = document.activeElement
  if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
    const start = Number(active.selectionStart)
    const end = Number(active.selectionEnd)
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      return String(active.value || '').slice(start, end).trim()
    }
  }
  const selection = window.getSelection?.()?.toString?.().trim?.() || ''
  if (selection) return selection
  return detailContent.value || ''
}

function canDirectEditDetail(n) {
  return ['transcribe', 'analyze', 'sum', 'gen', 'idea', 'ideaCard'].includes(n?.type)
}

function saveManualDetailRevision(n, value) {
  if (!n) return
  n.data.manualDetail = value
  n.data.s = '已保存人工修订'
}

function captureDetailSelection(event = null) {
  const active = document.activeElement
  const n = selectedNode.value
  if (!n || !active || !active.classList?.contains('wf-side-text')) return null
  const start = Number(active.selectionStart)
  const end = Number(active.selectionEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  const value = String(active.value || '')
  const text = value.slice(start, end)
  if (!text.trim()) return null
  detailSelectionState.text = text
  detailSelectionState.start = start
  detailSelectionState.end = end
  detailSelectionState.nodeId = n.id
  detailSelectionState.field = n.type
  if (event) {
    aiAnnotator.x = clamp(event.clientX, 12, Math.max(12, window.innerWidth - 380))
    aiAnnotator.y = clamp(event.clientY, 12, Math.max(12, window.innerHeight - 260))
  }
  aiAnnotator.quote = text.length > 180 ? text.slice(0, 180) + '...' : text
  return { text, start, end, nodeId: n.id }
}

function clearDetailSelectionState() {
  detailSelectionState.text = ''
  detailSelectionState.start = 0
  detailSelectionState.end = 0
  detailSelectionState.nodeId = null
  detailSelectionState.field = ''
}

function closeAiAnnotator() {
  aiAnnotator.show = false
}

function openAiAnnotatorFromButton(event) {
  const captured = captureDetailSelection(event)
  if (!captured && !detailSelectionState.text) return
  aiAnnotator.show = true
}

function maybeOpenAiAnnotator(event) {
  const captured = captureDetailSelection(event)
  if (!captured) return false
  aiAnnotator.show = true
  ctx.show = false
  return true
}

function replaceDetailSelection(replacement) {
  const n = selectedNode.value
  if (!n || n.id !== detailSelectionState.nodeId) return false
  const full = String(detailContent.value || '')
  const start = detailSelectionState.start
  const end = detailSelectionState.end
  if (start < 0 || end <= start || end > full.length) return false
  const next = full.slice(0, start) + replacement + full.slice(end)
  if (canDirectEditDetail(n)) detailContent.value = next
  else saveManualDetailRevision(n, next)
  clearDetailSelectionState()
  closeAiAnnotator()
  return true
}

function cleanAnnotationReplacement(reply, target = '') {
  let text = assertCleanModelReply(reply)
    .replace(/^```[a-zA-Z]*\s*/g, '')
    .replace(/\s*```$/g, '')
    .trim()
  const labels = ['替换后', '修改后', '改写后', '新文案', '新版', '结果']
  for (const label of labels) {
    const match = text.match(new RegExp(label + '[：:]\\s*([\\s\\S]+)$'))
    if (match?.[1]) {
      text = match[1].trim()
      break
    }
  }
  const original = String(target || '').trim()
  if (original && text.includes(original)) {
    text = text.replace(original, '').replace(/^(原文|选中文本)[：:]\s*/gm, '').trim()
  }
  text = text.replace(/^(替换后|修改后|改写后|新文案|结果)[：:]\s*/i, '').trim()
  if (detailSelectionState.field === 'ideaCard') text = stripIdeaCardDisplayText(text)
  return text
}

async function applyAiAnnotation() {
  const n = selectedNode.value
  const target = detailSelectionState.text
  if (!n || !target || interventionBusy.value) return
  interventionBusy.value = true
  n.data.s = 'AI批注改写中...'
  try {
    const d = await chatMinimax({
      model: 'gpt-5.5',
      system: '你是文案工作流的局部改写助手。只根据用户选中的文本和批注要求改写这一小段。只返回可直接替换选区的正文，不要解释、不要标题、不要 Markdown 包裹。',
      prompt: [
        '批注要求：' + (interventionNote.value || '优化这段表达'),
        '',
        '选中文本：',
        target
      ].join('\n')
    })
    const reply = cleanAnnotationReplacement(d.reply, target)
    if (reply && replaceDetailSelection(reply)) {
      n.data.s = 'AI批注已替换选中段'
    } else {
      n.data.s = 'AI批注没有可替换内容'
    }
  } catch (e) {
    n.data.s = 'AI批注失败: ' + e.message
  } finally {
    interventionBusy.value = false
  }
}

function looksLikeModelError(text) {
  return /^error\s*:/i.test(String(text || '').trim()) || /ECONNRESET|ETIMEDOUT|timeout|network/i.test(String(text || ''))
}

function assertCleanModelReply(reply) {
  const text = String(reply || '').trim()
  if (!text) return ''
  if (looksLikeModelError(text)) {
    throw new Error(text.replace(/^error\s*:\s*/i, '') || 'AI request failed')
  }
  return text
}

function togglePlanMode() {
  planMode.open = !planMode.open
  if (planMode.open && !planMode.question) {
    planMode.question = '先和我一步一步讨论方案，不要直接生成成稿。'
  }
}

function planContextText() {
  const inputBlocks = nodes.value
    .filter(n => n.type === 'input')
    .map((n, index) => {
      const data = n.data || {}
      const lines = [
        `## 输入源 ${index + 1}`,
        `类型：${inputSourceType(n) === 'brief' ? '商单 BF / 需求文' : '视频链接 / 素材'}`,
        data.briefTitle ? `BF标题：${data.briefTitle}` : '',
        data.url ? `链接：${data.url}` : '',
        data.idea ? `补充/BF内容：${cleanTranscriptText(data.idea).slice(0, 2600)}` : '',
      ].filter(Boolean)
      return lines.join('\n')
    })
    .filter(Boolean)
  const selected = selectedNode.value ? detailText(selectedNode.value) : ''
  const transcribe = nodes.value.filter(n => n.type === 'transcribe' && n.data.text).map(n => detailText(n)).join('\n\n')
  const analyze = nodes.value.filter(n => n.type === 'analyze' && n.data.r).map(n => detailText(n)).join('\n\n')
  const summary = nodes.value.filter(n => n.type === 'sum' && n.data.txt).map(n => detailText(n)).join('\n\n')
  const ideas = nodes.value.filter(n => n.type === 'idea' && n.data.list?.length).map(n => detailText(n)).join('\n\n')
  const context = [inputBlocks.join('\n\n'), planMode.sourceContext, selected, transcribe, analyze, summary, ideas].filter(Boolean).join('\n\n').slice(0, 16000)
  const hasInput = inputBlocks.length > 0
  const hasCollected = Boolean(transcribe || analyze || summary)
  planMode.contextStatus = hasCollected
    ? '已读取输入源 + 已采集/拆解内容'
    : hasInput
      ? '已读取输入源；链接内容需先跑信息采集'
      : '暂无输入源，AI会先问你补充材料'
  return context
}

async function collectPlanSources() {
  if (planMode.collecting) return planMode.sourceContext
  const inputNodes = nodes.value.filter(n => n.type === 'input')
  if (!inputNodes.length) {
    planMode.contextStatus = '暂无输入源，AI会先问你补充材料'
    return ''
  }
  planMode.collecting = true
  planMode.contextStatus = '正在读取/转写输入源...'
  const blocks = []
  try {
    for (let i = 0; i < inputNodes.length; i += 1) {
      const node = inputNodes[i]
      const data = node.data || {}
      const lines = [`## Plan输入源 ${i + 1}`]
      if (data.briefTitle) lines.push('BF标题：' + data.briefTitle)
      const manualText = cleanTranscriptText(data.idea || '')
      if (manualText) lines.push('手动/BF内容：\n' + manualText.slice(0, 4500))
      const urls = extractWorkflowUrls(data.url || '')
      for (let u = 0; u < urls.length; u += 1) {
        const url = urls[u]
        try {
          const collected = await collectWorkflowSource(url, u + 1)
          lines.push((collected.ok ? collected.label : collected.label + '（读取失败）') + '\n' + (collected.text || collected.error || ''))
        } catch (e) {
          lines.push('链接读取失败：' + url + '\n' + (e.message || String(e)))
        }
      }
      blocks.push(lines.filter(Boolean).join('\n\n'))
    }
    planMode.sourceContext = blocks.join('\n\n').slice(0, 14000)
    planMode.contextStatus = planMode.sourceContext ? '已读取/转写输入源；可继续讨论' : '未读取到可用输入源内容'
    return planMode.sourceContext
  } finally {
    planMode.collecting = false
  }
}

function parsePlanAssistantReply(reply) {
  const text = assertCleanModelReply(reply)
  const options = []
  const optionBlock = text.match(/(?:\u9009\u9879|\u53ef\u9009\u65b9\u6848|Options)[\uff1a:]\s*([\s\S]+)$/i)
  const source = optionBlock?.[1] || text
  source.split(/\r?\n/).forEach(line => {
    const hit = line.match(/^\s*(?:[-*]|\d+[.\u3001)]|[A-C][.\u3001)])\s*(.{4,80})$/i)
    if (hit?.[1] && options.length < 3) options.push(hit[1].trim())
  })
  return { text, options: Array.from(new Set(options)).slice(0, 3) }
}

function askPlanQuick(question) {
  planMode.question = question
  runPlanAsk()
}

async function runPlanAsk() {
  if (planMode.busy) return
  const question = String(planMode.question || '').trim()
  if (!question) return
  planMode.busy = true
  planMode.messages.push({ role: 'user', content: question })
  planMode.question = ''
  try {
    if (!planMode.sourceContext && nodes.value.some(n => n.type === 'input')) {
      await collectPlanSources()
    }
    const history = planMode.messages.slice(-8).map(item => (item.role === 'user' ? '用户：' : 'AI：') + item.content).join('\n\n')
    const d = await chatMinimax({
      model: 'gpt-5.5',
      system: '你是文案工作流的 Plan 辅助板块，交互方式类似 Codex。你要先讨论方案，不要直接写完整成稿。每次回答都要给判断、建议，并尽量给 2-3 个可点击的选项。选项要短，适合按钮显示。',
      prompt: [
        history ? '历史对话：\n' + history : '',
        planMode.draft ? '已确认/沉淀的方案：\n' + planMode.draft : '',
        '',
        '当前工作流材料：',
        planContextText() || '暂无材料，请先给出需要用户补充的信息。',
        '',
        '请输出：',
        '1. 你的判断：用 2-4 句话说明。',
        '2. 推荐推进：告诉用户下一步怎么选。',
        '3. 选项：给 2-3 个短选项，每行一个，用 “1. ...” 格式。',
        '4. 如果用户已经在确认方案，请给一段“可写入方案摘要”。'
      ].filter(Boolean).join('\n')
    })
    const parsed = parsePlanAssistantReply(d.reply)
    planMode.messages.push({ role: 'assistant', content: parsed.text, options: parsed.options })
  } catch (e) {
    planMode.messages.push({ role: 'assistant', content: 'Plan 辅助失败：' + e.message, options: [] })
  } finally {
    planMode.busy = false
  }
}

function choosePlanOption(option) {
  const text = String(option || '').trim()
  if (!text) return
  planMode.confirmed = true
  planMode.draft = [planMode.draft, text].filter(Boolean).join('\n\n')
  planMode.question = '我选择：' + text + '。基于这个选择，继续问我下一步该确认什么，并给选项。'
  runPlanAsk()
}

function resetPlanAssist() {
  planMode.question = ''
  planMode.draft = ''
  planMode.messages = []
  planMode.confirmed = false
  planMode.sourceContext = ''
  planMode.contextStatus = ''
  planMode.collecting = false
  planMode.busy = false
}

function applyPlanToIdea() {
  const text = String(planMode.draft || '').trim()
  if (!text) return
  let idea = selectedNode.value?.type === 'idea' ? selectedNode.value : nodes.value.find(n => n.type === 'idea')
  if (!idea) {
    const center = viewportCenter()
    idea = addNode('idea', center.x + 260, center.y)
  }
  idea.data.list = normalizeIdeaRows(text).slice(0, 3)
  if (!idea.data.list.length) idea.data.list = [text]
  idea.data.sel = -1
  idea.data.s = 'Plan 模式方案已写入'
  sel.value = idea.id
}

function removeComment(id) {
  const n = selectedNode.value
  if (!n?.data?.comments) return
  n.data.comments = n.data.comments.filter(item => item.id !== id)
}

async function rewriteDetailSelection() {
  const n = selectedNode.value
  const target = detailSelection()
  if (!n || !target || interventionBusy.value) return
  interventionBusy.value = true
  n.data.s = 'AI 重写中...'
  try {
    const d = await chatMinimax({
      model: 'gpt-5.5',
      system: '请用中文重写选中的工作流文本。只返回替换后的正文。',
      prompt: '修改要求：' + (interventionNote.value || '表达更清楚') + '\n\nText:\n' + target
    })
    const reply = assertCleanModelReply(d.reply)
    if (reply) {
      detailContent.value = target === detailContent.value ? reply : detailContent.value.replace(target, reply)
      n.data.s = 'AI重写 done'
    }
  } catch (e) {
    n.data.s = 'AI重写 failed: ' + e.message
  } finally {
    interventionBusy.value = false
  }
}

async function commentDetailSelection() {
  const n = selectedNode.value
  const target = detailSelection()
  if (!n || !target || interventionBusy.value) return
  interventionBusy.value = true
  n.data.s = 'AI 批注处理中...'
  try {
    const d = await chatMinimax({
      model: 'gpt-5.5',
      system: '请根据批注要求改写选中文本。只返回替换后的正文。',
      prompt: '批注：' + (interventionNote.value || '优化这一段') + '\n\nText:\n' + target
    })
    const replacementText = cleanAnnotationReplacement(d.reply, target)
    if (replacementText) {
      detailContent.value = target === detailContent.value ? replacementText : detailContent.value.replace(target, replacementText)
      n.data.s = 'AI 替换完成'
    }
  } catch (e) {
    n.data.s = 'AI 批注失败: ' + e.message
  } finally {
    interventionBusy.value = false
  }
}


const canvasStyle = computed(() => ({
  transform: `translate(${off.value.x}px, ${off.value.y}px) scale(${sc.value})`,
  transformOrigin: '0 0',
}))

const gridStyle = computed(() => {
  const size = GRID * sc.value
  return {
    backgroundSize: `${size}px ${size}px`,
    backgroundPosition: `${off.value.x % size}px ${off.value.y % size}px`,
  }
})

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function snap(v) {
  return Math.round(v / 12) * 12
}

function canvasRect() {
  return canvasRef.value?.getBoundingClientRect()
}

function screenPoint(e) {
  const rect = canvasRect()
  if (!rect) return { x: 0, y: 0 }
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function screenToWorld(x, y) {
  return {
    x: (x - off.value.x) / sc.value,
    y: (y - off.value.y) / sc.value,
  }
}

function toWorld(e) {
  const p = screenPoint(e)
  return screenToWorld(p.x, p.y)
}

function portPoint(n, dir, portIdx = 0) {
  if (dir === 'out') return { x: n.x + NODE_W, y: n.y + OUT_PORT_Y }
  return { x: n.x, y: n.y + inputPortY(n, portIdx) }
}

function pathBetween(start, end) {
  const dx = end.x - start.x
  const bend = Math.min(112, Math.max(56, Math.abs(dx) * 0.26))
  const c1x = start.x + bend
  const c2x = end.x - bend
  return `M${start.x},${start.y} C${c1x},${start.y} ${c2x},${end.y} ${end.x},${end.y}`
}

function curvePath(l) {
  const f = nodes.value.find(n => n.id === l.f)
  const t = nodes.value.find(n => n.id === l.t)
  if (!f || !t) return ''
  return pathBetween(portPoint(f, 'out', l.fPort), portPoint(t, 'in', l.tPort))
}

const dlPath = computed(() => {
  if (!dl.value) return ''
  return pathBetween({ x: dl.value.x1, y: dl.value.y1 }, { x: dl.value.x2, y: dl.value.y2 })
})

function bindWindowDrag() {
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function stopWindowDrag() {
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onUp)
}

function isCanvasTarget(target) {
  return target === canvasRef.value ||
    target?.classList?.contains('wf-canvas') ||
    target?.classList?.contains('wf-world') ||
    target?.classList?.contains('wf-svg')
}

function onDown(e) {
  if (e.button !== 0 || !isCanvasTarget(e.target)) return
  dWhat.value = 'canvas'
  dOff.value = { x: e.clientX - off.value.x, y: e.clientY - off.value.y }
  sel.value = null
  ctx.show = false
  bindWindowDrag()
}

function isInteractiveTarget(target) {
  return !!target?.closest?.('button,input,textarea,select,a,[contenteditable="true"],.wf-port,.wf-nx')
}

function selectNode(n) {
  sel.value = n.id
  ctx.show = false
}

function dragN(e, n) {
  if (e.button !== 0) return
  selectNode(n)
  if (isInteractiveTarget(e.target)) return
  const p = toWorld(e)
  dWhat.value = 'node-pending'
  pendingNodeDrag.value = { id: n.id, sx: e.clientX, sy: e.clientY }
  dOff.value = { x: p.x - n.x, y: p.y - n.y }
  bindWindowDrag()
}

function onMove(e) {
  if (dWhat.value === 'canvas') {
    off.value = { x: e.clientX - dOff.value.x, y: e.clientY - dOff.value.y }
  } else if (dWhat.value === 'node-pending') {
    const p = pendingNodeDrag.value
    if (!p || Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 5) return
    dWhat.value = 'node'
    moveSelectedNode(e)
  } else if (dWhat.value === 'node' && sel.value) {
    moveSelectedNode(e)
  } else if (dWhat.value === 'line' && dl.value) {
    updateDraftLine(e)
  }
}

function moveSelectedNode(e) {
  const n = nodes.value.find(n => n.id === sel.value)
  if (!n) return
  const p = toWorld(e)
  n.x = snap(p.x - dOff.value.x)
  n.y = snap(p.y - dOff.value.y)
}

function onUp(e) {
  if (dWhat.value === 'line' && dl.value) {
    const target = hoverPort.value || connectionTarget(toWorld(e))
    if (target) commitConnection(target)
    dl.value = null
    dlF.value = null
    hoverPort.value = null
  }
  dWhat.value = null
  pendingNodeDrag.value = null
  stopWindowDrag()
}

function sL(e, n, dir, portIdx) {
  if (e.button !== 0) return
  e.stopPropagation()
  dWhat.value = 'line'
  dlF.value = n
  dlDir.value = dir
  dlPort.value = portIdx
  hoverPort.value = null
  ctx.show = false

  const start = portPoint(n, dir, portIdx)
  const pointer = toWorld(e)
  dl.value = dir === 'out'
    ? { x1: start.x, y1: start.y, x2: pointer.x, y2: pointer.y }
    : { x1: pointer.x, y1: pointer.y, x2: start.x, y2: start.y }
  bindWindowDrag()
}

function updateDraftLine(e) {
  const pointer = toWorld(e)
  const target = connectionTarget(pointer)
  hoverPort.value = target
    ? { ...target, nodeId: target.node.id }
    : null

  if (dlDir.value === 'out') {
    const end = target ? portPoint(target.node, 'in', target.port) : pointer
    dl.value.x2 = end.x
    dl.value.y2 = end.y
  } else {
    const start = target ? portPoint(target.node, 'out', target.port) : pointer
    dl.value.x1 = start.x
    dl.value.y1 = start.y
  }
}

function isHoverPort(n, dir, port) {
  const hp = hoverPort.value
  return !!hp && hp.nodeId === n.id && hp.dir === dir && hp.port === port
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function hitNode(point, exceptId = null) {
  return [...nodes.value].reverse().find(n => {
    if (n.id === exceptId) return false
    return point.x >= n.x - 18 &&
      point.x <= n.x + NODE_W + 18 &&
      point.y >= n.y - 12 &&
      point.y <= n.y + NODE_H + 28
  }) || null
}

function connectionTarget(point) {
  if (!dlF.value) return null
  const dir = dlDir.value === 'out' ? 'in' : 'out'
  let best = null

  for (const n of nodes.value) {
    if (n.id === dlF.value.id) continue
    const ports = dir === 'in' ? IN_PORTS.map((_, port) => port) : [0]
    for (const port of ports) {
      const pt = portPoint(n, dir, port)
      const d = distance(point, pt)
      if (d <= PORT_SNAP && (!best || d < best.d)) {
        best = { node: n, dir, port, d }
      }
    }
  }

  if (best) return best

  const node = hitNode(point, dlF.value.id)
  if (!node) return null
  return {
    node,
    dir,
    port: dir === 'in' ? findFreePort(node) : 0,
  }
}

function commitConnection(target) {
  if (dlDir.value === 'out') {
    addL(dlF.value, 0, target.node, target.port)
  } else {
    addL(target.node, 0, dlF.value, dlPort.value)
  }
}

function findFreePort(n) {
  const used = lines.value.filter(l => l.t === n.id).map(l => l.tPort)
  for (let i = 0; i < IN_PORTS.length; i++) {
    if (!used.includes(i)) return i
  }
  return 0
}

function wouldCreateCycle(sourceId, targetId) {
  const stack = [targetId]
  const seen = new Set()
  while (stack.length) {
    const id = stack.pop()
    if (id === sourceId) return true
    if (seen.has(id)) continue
    seen.add(id)
    lines.value.filter(l => l.f === id).forEach(l => stack.push(l.t))
  }
  return false
}

function addL(f, fPort, t, tPort) {
  if (!f || !t || f.id === t.id) return false
  if (wouldCreateCycle(f.id, t.id)) return false
  if (lines.value.some(l => l.f === f.id && l.t === t.id)) return false
  const occupied = new Set(lines.value.filter(l => l.t === t.id).map(l => l.tPort))
  const preferred = Number.isFinite(Number(tPort)) ? Number(tPort) : 0
  const freePort = occupied.has(preferred)
    ? IN_PORTS.findIndex((_, index) => !occupied.has(index))
    : preferred
  const targetPort = freePort < 0 ? preferred : freePort
  lines.value.push({
    id: 'l' + (nID++),
    f: f.id,
    t: t.id,
    fPort,
    tPort: targetPort,
  })
  return true
}

function rmL(id) {
  lines.value = lines.value.filter(l => l.id !== id)
}

function rmN(id) {
  lines.value = lines.value.filter(l => l.f !== id && l.t !== id)
  nodes.value = nodes.value.filter(n => n.id !== id)
  if (sel.value === id) sel.value = null
  if (outputViewer.show && !selectedNode.value) closeOutput()
}

function zoomAt(clientX, clientY, nextScale) {
  const rect = canvasRect()
  if (!rect) return
  const local = { x: clientX - rect.left, y: clientY - rect.top }
  const before = screenToWorld(local.x, local.y)
  const next = clamp(nextScale, MIN_ZOOM, MAX_ZOOM)
  sc.value = next
  off.value = {
    x: local.x - before.x * next,
    y: local.y - before.y * next,
  }
}

function zoomBy(direction) {
  const rect = canvasRect()
  if (!rect) return
  const factor = direction > 0 ? 1.12 : 0.88
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, sc.value * factor)
}

function fitView() {
  const rect = canvasRect()
  if (!rect || !nodes.value.length) return
  const pad = 120
  const minX = Math.min(...nodes.value.map(n => n.x))
  const minY = Math.min(...nodes.value.map(n => n.y))
  const maxX = Math.max(...nodes.value.map(n => n.x + NODE_W))
  const maxY = Math.max(...nodes.value.map(n => n.y + NODE_H))
  const contentW = Math.max(1, maxX - minX)
  const contentH = Math.max(1, maxY - minY)
  const next = clamp(Math.min((rect.width - pad) / contentW, (rect.height - pad) / contentH), MIN_ZOOM, 1)
  sc.value = next
  off.value = {
    x: (rect.width - contentW * next) / 2 - minX * next,
    y: (rect.height - contentH * next) / 2 - minY * next,
  }
}

function onWheel(e) {
  const factor = Math.exp(-e.deltaY * 0.0012)
  zoomAt(e.clientX, e.clientY, sc.value * factor)
}

function onCtx(e) {
  if (maybeOpenAiAnnotator(e)) return
  const rect = canvasRect()
  if (!rect) return
  const raw = screenPoint(e)
  const world = toWorld(e)
  ctx.x = clamp(raw.x, 8, Math.max(8, rect.width - 184))
  ctx.y = clamp(raw.y, 8, Math.max(8, rect.height - 340))
  ctx.wx = world.x
  ctx.wy = world.y
  ctx.nid = hitNode(world)?.id || null
  ctx.show = true
}

function addNode(type, x, y) {
  const node = mk(type, snap(x), snap(y))
  nodes.value.push(node)
  sel.value = node.id
  return node
}

function viewportCenter() {
  const rect = canvasRect()
  if (!rect) return { x: 120, y: 120 }
  return screenToWorld(rect.width / 2, rect.height / 2)
}

function addNodeFromPalette(type) {
  const center = viewportCenter()
  const stagger = (nodes.value.length % 4) * 18
  addNode(type, center.x - NODE_W / 2 + stagger, center.y - NODE_H / 2 + stagger)
  ctx.show = false
}

function ctxDo(action, type) {
  if (action === 'del' && ctx.nid) {
    rmN(ctx.nid)
  } else if (action === 'dup' && ctx.nid) {
    const s = nodes.value.find(n => n.id === ctx.nid)
    if (s) {
      const d = mk(s.type, snap(s.x + 36), snap(s.y + 36))
      d.data = JSON.parse(JSON.stringify(s.data))
      nodes.value.push(d)
      sel.value = d.id
    }
  } else if (action === 'add' && type) {
    addNode(type, ctx.wx - NODE_W / 2, ctx.wy - NODE_H / 2)
  }
  ctx.show = false
}

function upstreamNodes(n) {
  return lines.value
    .filter(l => l.t === n.id)
    .sort((a, b) => a.tPort - b.tPort)
    .map(l => nodes.value.find(x => x.id === l.f))
    .filter(Boolean)
}

function nodeText(n) {
  if (!n) return ''
  if (n.type === 'transcribe') return n.data.text || ''
  if (n.type === 'sum') return n.data.txt || ''
  if (n.type === 'analyze') return n.data.r || ''
  if (n.type === 'input') return n.data.url || n.data.idea || ''
  if (n.type === 'platform') return platformDetailText(n)
  if (n.type === 'ideaCard') return n.data.text || ''
  if (n.type === 'gen') return n.data.out || ''
  return ''
}

function gD(n, ty, vis = new Set()) {
  if (!n || vis.has(n.id)) return ''
  const rows = gAll(n, ty, vis)
  if (!rows.length) return ''
  if (rows.length === 1) return rows[0].text
  return rows.map((item, index) => section((item.node.label || typeCode(item.node.type)) + ' ' + (index + 1), item.text)).join('\n\n')
}

function gAll(n, ty, vis = new Set()) {
  if (!n || vis.has(n.id)) return []
  vis.add(n.id)
  const out = []
  for (const u of upstreamNodes(n)) {
    if (u.type === ty) {
      const text = nodeText(u)
      if (text) out.push({ node: u, text })
    }
    out.push(...gAll(u, ty, vis))
  }
  const seen = new Set()
  return out.filter(item => {
    const key = item.node.id + ':' + item.text.slice(0, 80)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function upstreamText(n, types = [], options = {}) {
  const parts = []
  const seen = new Set()
  const collect = (node) => {
    if (!node || seen.has(node.id)) return
    seen.add(node.id)
    const direct = !types.length || types.includes(node.type)
    const text = direct ? nodeText(node) : ''
    if (text) parts.push(section(node.label || typeCode(node.type), text))
    upstreamNodes(node).forEach(collect)
  }
  upstreamNodes(n).forEach(collect)
  const joined = parts.filter(Boolean).join('\n\n')
  return options.max ? joined.slice(0, options.max) : joined
}

function inputData(n) {
  const direct = upstreamNodes(n).find(u => u.type === 'input')
  if (direct) return direct.data
  const inputTextNode = nodes.value.find(x => x.type === 'input')
  return inputTextNode?.data || {}
}

function inputSources(n) {
  const direct = upstreamNodes(n).filter(u => u.type === 'input')
  if (direct.length) return direct.map((node, index) => ({ node, data: node.data || {}, index }))
  const fallback = nodes.value.find(x => x.type === 'input')
  return fallback ? [{ node: fallback, data: fallback.data || {}, index: 0 }] : []
}

function downstreamNodes(n) {
  return lines.value
    .filter(l => l.f === n.id)
    .sort((a, b) => a.tPort - b.tPort)
    .map(l => nodes.value.find(x => x.id === l.t))
    .filter(Boolean)
}

function isBlockingStatus(n) {
  const s = String(n?.data?.s || '')
  return !s || /待运行|需要|失败|运行中|error|failed/i.test(s)
}

function canAutoContinue(n) {
  if (!n || isBlockingStatus(n)) return false
  if (n.type === 'input') return !!(n.data.url || n.data.idea)
  if (n.type === 'transcribe') return !!n.data.text
  if (n.type === 'analyze') return !!n.data.r
  if (n.type === 'sum') return !!n.data.txt
  if (n.type === 'idea') return (n.data.list || []).length > 0
  if (n.type === 'ideaCard') return !!n.data.text
  if (n.type === 'gen') return !!n.data.out
  return true
}

function upstreamReady(n, ctx) {
  const ups = upstreamNodes(n)
  return ups.every(u => canAutoContinue(u) && !u.run && !ctx.active.has(u.id))
}

async function runDownstream(n, ctx) {
  if (n.type === 'idea' || n.type === 'gen') return
  const next = downstreamNodes(n).filter(x => x.type !== 'gen')
  await Promise.all(next.map(async (target) => {
    if (ctx.started.has(target.id) || !upstreamReady(target, ctx)) return
    ctx.started.add(target.id)
    await runN(target, { auto: true, ctx })
  }))
}

function parseIdeaRow(row, idx = 0) {
  const text = String(row || '').trim()
  const parts = text.split('|').map(x => x.trim()).filter(Boolean)
  return {
    title: parts[0] || '创意方向 ' + (idx + 1),
    entry: parts[1] || '',
    framework: parts[2] || '',
    ending: parts[3] || '',
    text
  }
}

function parseIdeaCardDetailText(value, idx = 0) {
  const text = stripIdeaCardDisplayText(value)
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const fields = { title: '', entry: '', framework: '', ending: '' }
  const rest = []
  const matchers = [
    ['entry', /^(?:\u5207\u5165\u70b9|\u5207\u5165|\u5165\u53e3|\u89d2\u5ea6)\s*[\uff1a:]\s*(.+)$/i],
    ['framework', /^(?:\u6846\u67b6|\u7ed3\u6784|\u5185\u5bb9\u6846\u67b6)\s*[\uff1a:]\s*(.+)$/i],
    ['ending', /^(?:\u7ed3\u5c3e|\u6536\u675f|\u7ed3\u5c3e\u65b9\u5f0f)\s*[\uff1a:]\s*(.+)$/i],
  ]
  for (const rawLine of lines) {
    const line = rawLine.replace(/^#{1,4}\s*/, '').trim()
    let matched = false
    for (const [key, pattern] of matchers) {
      const hit = line.match(pattern)
      if (hit?.[1]) {
        fields[key] = hit[1].trim()
        matched = true
        break
      }
    }
    if (!matched) rest.push(line)
  }
  if (fields.entry || fields.framework || fields.ending) {
    fields.title = rest[0] || ('\u521b\u610f\u65b9\u5411 ' + (idx + 1))
    return {
      ...fields,
      text: [fields.title, fields.entry, fields.framework, fields.ending].filter(Boolean).join(' | ')
    }
  }
  return parseIdeaRow(text, idx)
}

function normalizeIdeaRows(reply) {
  const text = assertCleanModelReply(reply)
  const rawLines = text
    .replace(/```[\s\S]*?```/g, block => block.replace(/```[a-zA-Z]*|```/g, ''))
    .split(/\n+/)
    .map(line => line.replace(/^\s*(?:[-*]|\d+[.、)]|创意\s*\d+[:：]?)/i, '').trim())
    .filter(Boolean)
  let rows = rawLines.filter(line => line.includes('|'))
  if (!rows.length) {
    rows = text
      .split(/(?:^|\n)\s*(?:\d+[.、)]|[-*]|创意\s*\d+[:：]?)/i)
      .map(chunk => chunk.replace(/\n+/g, ' ').trim())
      .filter(chunk => chunk.length > 12)
      .slice(0, 3)
  }
  if (!rows.length) rows = rawLines.slice(0, 3)
  return rows.slice(0, 3).map((row, idx) => {
    const cleaned = row.replace(/\s+/g, ' ').trim()
    if (cleaned.includes('|')) return cleaned
    const title = cleaned.match(/^(.{4,28}?)[：:，,。]/)?.[1] || `创意方向 ${idx + 1}`
    return `${title} | ${cleaned} | 按上游拆解顺序展开 | 以上游 BF/素材中的卖点、要求和风险为论据 | 收束到行动或情绪记忆点`
  })
}

function createIdeaCards(n) {
  if (!n?.data?.list?.length) return []
  const oldIds = new Set(nodes.value.filter(x => x.type === 'ideaCard' && x.data.sourceIdeaId === n.id).map(x => x.id))
  if (oldIds.size) {
    nodes.value = nodes.value.filter(x => !oldIds.has(x.id))
    lines.value = lines.value.filter(l => !oldIds.has(l.f) && !oldIds.has(l.t))
  }
  const cards = n.data.list.slice(0, 3).map((row, idx) => {
    const parsed = parseIdeaRow(row, idx)
    const card = mk('ideaCard', n.x + 340, n.y - 120 + idx * 245)
    card.data = {
      ...card.data,
      ...parsed,
      sourceIdeaId: n.id,
      words: n.data.words || String(DEFAULT_WORDS),
      styleRef: null,
      styleConfirmed: false,
      styleSkipped: true,
      styleReason: '不使用风格',
      s: '等待确认'
    }
    nodes.value.push(card)
    addL(n, 0, card, 0)
    return card
  })
  return cards
}

function ideaCardOrder(card) {
  if (!card?.data?.sourceIdeaId) return 1
  const cards = nodes.value.filter(x => x.type === 'ideaCard' && x.data.sourceIdeaId === card.data.sourceIdeaId)
  return Math.max(1, cards.findIndex(x => x.id === card.id) + 1)
}

function ensureGenNode(card) {
  const existing = downstreamNodes(card).find(x => x.type === 'gen')
  if (existing) return existing
  const gen = mk('gen', card.x + 312, card.y)
  gen.data.words = card.data.words || String(DEFAULT_WORDS)
  nodes.value.push(gen)
  addL(card, 0, gen, 0)
  return gen
}

function ideaCardText(card) {
  if (!card?.data) return ''
  return card.data.text || [card.data.title, card.data.entry, card.data.framework, card.data.ending].filter(Boolean).join(' | ')
}


async function generateIdeaCardCopy(card) {
  if (!card || card.run) return
  const rep = gD(card, 'sum')
  const sourceText = gD(card, 'transcribe') || upstreamText(card, ['input'], { max: 9000 })
  const idea = ideaCardText(card)
  if (!sourceText || !idea) {
    card.data.s = '需要原文和创意卡'
    return
  }
  const gen = ensureGenNode(card)
  gen.data.words = card.data.words || gen.data.words || String(DEFAULT_WORDS)
  gen.data.styleRef = card.data.styleRef || null
  gen.data.styleSkipped = card.data.styleSkipped !== false
  gen.data.styleConfirmed = !!card.data.styleConfirmed
  gen.data.styleReason = card.data.styleReason || ''
  sel.value = gen.id
  const source = nodes.value.find(x => x.id === card.data.sourceIdeaId)
  if (source) {
    const ideaIndex = (source.data.list || []).findIndex(x => x === card.data.text)
    source.data.sel = ideaIndex
  }
  card.run = true
  gen.run = true
  card.data.s = '生成文案中...'
  gen.data.s = '生成文案中...'
  try {
    const styleRef = card.data.styleSkipped ? null : (card.data.styleRef || null)
    const d = await withTimeout(
      chatMinimax({
        model: 'gpt-5.5',
        prompt: buildIdeaCardCopyPrompt(sourceText, rep, idea, card.data.words, styleRef),
        system: '根据原文、用户确认的创意卡和用户手动选择的风格卡生成中文短视频成稿，只返回正文。',
        ...copyModelOptions(card.data.words, 'draft')
      }),
      copyModelOptions(card.data.words, 'draft').timeoutMs + 30000,
      '生成文案'
    )
    const firstDraft = d.reply || ''
    if (looksLikeModelError(firstDraft)) {
      const modelError = String(firstDraft || '').replace(/^error\s*:\s*/i, '')
      throw new Error(modelError || 'AI request failed')
    }
    gen.data.s = '自检修稿中...'
    const checked = await withTimeout(
      chatMinimax({
        model: 'gpt-5.5',
        prompt: buildCopySelfCheckPrompt(firstDraft, sourceText, rep, idea, card.data.words),
        system: '你只做文案自检和修稿，直接输出修订后的最终正文。',
        ...copyModelOptions(card.data.words, 'selfcheck')
      }),
      copyModelOptions(card.data.words, 'selfcheck').timeoutMs + 30000,
      '自检修稿'
    )
    gen.data.out = checked.reply || firstDraft || '生成失败'
    if (looksLikeModelError(gen.data.out)) {
      const modelError = String(gen.data.out || '').replace(/^error\s*:\s*/i, '')
      gen.data.out = ''
      throw new Error(modelError || 'AI request failed')
    }
    gen.data.s = '文案已生成'
    card.data.s = '已生成到右侧文案节点'
  } catch (e) {
    card.data.s = 'error: ' + e.message
    gen.data.s = 'error: ' + e.message
  } finally {
    card.run = false
    gen.run = false
  }
}

async function pickI(n, idx = -1) {
  if (!n) return
  if (n.type === 'idea') {
    n.data.sel = idx
    sel.value = n.id
    return
  }
  if (n.type !== 'ideaCard') return
  selectNode(n)
  await generateIdeaCardCopy(n)
}

function pickIval(n) {
  const cardText = gD(n, 'ideaCard')
  if (cardText) return cardText
  const idea = upstreamNodes(n).find(x => x.type === 'idea') || nodes.value.find(x => x.type === 'idea')
  if (!idea) return ''
  const list = idea.data.list || []
  const idx = Number.isInteger(idea.data.sel) ? idea.data.sel : -1
  return idx >= 0 ? (list[idx] || '') : ''
}

function bR(n) {
  const cleanParts = ['材料使用权重\n1. 最终选题、论点、事实和主体表达，建议约 60% 来自转写原文，保留 40% 左右空间给创意延展。\n2. 结构拆解服务于理解转写原文，不能替代原文。\n3. 背景搜索只补充必要事实；向量库主要作为表达方式/案例参考，不作为事实主线。\n4. 如果辅助材料与转写原文不相关或冲突，直接忽略辅助材料，以转写原文为准。']
  const cleanSeen = new Set()
  const addCleanPart = (title, text, max = 1600) => {
    const body = String(text || '').trim()
    if (!body) return
    cleanParts.push(title + '\n' + (body.length > max ? body.slice(0, max) + '...' : body))
  }
  const collectClean = (node) => {
    if (!node || cleanSeen.has(node.id)) return
    cleanSeen.add(node.id)
    if (node.type === 'transcribe' && node.data.text) addCleanPart('转写原文（主依据）', formatTranscriptOutput(node.data.text), 2200)
    if (node.type === 'analyze' && node.data.r) addCleanPart('结构拆解', node.data.r, 1600)
    if (node.type === 'hot' && node.data.rs?.length) addCleanPart('背景搜索', hotDetailText(node), 1400)
    if (node.type === 'platform') addCleanPart('平台转写参考', formatPlatformResults(node), 1200)
    if (node.type === 'vec' && node.data.rs?.length) addCleanPart('向量库表达参考（不是事实主线）', formatSearchResults(node.data.rs), 700)
    upstreamNodes(node).forEach(collectClean)
  }
  upstreamNodes(n).forEach(collectClean)
  return cleanParts.join('\n\n')
  const parts = []
  const vis = new Set()
  function col(node) {
    if (node?.type === 'hot' && node.data.rs?.length) {
      parts.push('背景搜索' + '\n' + hotDetailText(node))
      upstreamNodes(node).forEach(col)
      return
    }
    if (node?.type === 'platform') {
      parts.push(formatPlatformResults(node))
      upstreamNodes(node).forEach(col)
      return
    }
    if (!node || vis.has(node.id)) return
    vis.add(node.id)
    if (node.type === 'transcribe' && node.data.text) parts.push('【转写原文】\n' + node.data.text)
    if (node.type === 'analyze' && node.data.r) parts.push('【结构分析】\n' + node.data.r)
    if (node.type === 'hot' && node.data.rs?.length) parts.push('背景搜索' + '\n' + hotDetailText(node))
    if (node.type === 'vec' && node.data.rs?.length) parts.push('向量库表达参考\n' + node.data.rs.map(r => '- ' + vectorResultText(r).substring(0, 180)).join('\n'))
    if (node.type === 'platform') parts.push(formatPlatformResults(node))
    upstreamNodes(node).forEach(col)
  }
  upstreamNodes(n).forEach(col)
  return parts.join('\n\n')
}

async function runN(n, options = {}) {
  if (n?.type === 'ideaCard') {
    await generateIdeaCardCopy(n)
    return
  }
  if (n.run) return
  const ctx = options.ctx || { started: new Set(), active: new Set() }
  ctx.started.add(n.id)
  ctx.active.add(n.id)
  n.run = true
  n.data.s = '运行中...'
  try {
    if (n.type === 'input') {
      if (inputSourceType(n) === 'brief') {
        n.data.s = (n.data.idea || n.data.url) ? 'BF source ready' : 'need BF content'
        return
      }
      cleanNodeUrl(n)
      n.data.s = (n.data.url || n.data.idea) ? '输入已就绪' : '需要链接或想法'
      return
    }

    if (n.type === 'transcribe') {
      const multi = await runMultiSourceTranscribe(n)
      if (multi.total) {
        n.data.collectErrors = multi.errors
        n.data.text = multi.blocks.join('\n\n')
        n.data.s = n.data.text
          ? '多源采集完成 ' + multi.blocks.length + '/' + multi.total
          : (multi.errors.length ? ('采集失败：' + multi.errors[0]) : '信息采集失败')
        return
      }
      const input = inputData(n)
      const urls = extractWorkflowUrls(n.data.url || input.url || '')
      if (inputDataSourceType(input) === 'brief') {
        const title = input.briefTitle || '商单 BF'
        let rawBrief = cleanTranscriptText(input.idea || '')
        const briefUrl = urls.find(isFeishuWorkflowUrl)
        if (briefUrl) {
          n.data.s = '读取飞书 BF...'
          const d = await collectFeishuWorkflowText(briefUrl)
          rawBrief = cleanTranscriptText(d.text || rawBrief || d.error || '')
          if (!input.briefTitle && d.title) input.briefTitle = d.title
        }
        n.data.rawBrief = rawBrief
        n.data.text = rawBrief ? buildBriefDigest(rawBrief, input.briefTitle || title) : ''
        n.data.s = n.data.text ? 'BF 信息采集完成' : '需要 BF 内容'
        return
      }
      const blocks = []
      const errors = []
      const manualText = collectManualInputText(input)
      if (manualText) blocks.push('手动补充\n' + manualText)
      if (!urls.length && !manualText) { n.data.s = '需要链接、文档或手动文本'; return }
      for (let i = 0; i < urls.length; i += 1) {
        const currentUrl = urls[i]
        n.data.s = '信息采集中 ' + (i + 1) + '/' + urls.length
        try {
          const collected = await collectWorkflowSource(currentUrl, i + 1)
          if (collected.ok) blocks.push(collected.label + '\n' + collected.text)
          else errors.push(collected.label + '：' + collected.error)
        } catch (e) {
          errors.push('来源 ' + (i + 1) + '：' + (e.message || String(e)))
        }
      }
      n.data.collectErrors = errors
      n.data.text = blocks.join('\n\n')
      if (n.data.text) {
        n.data.s = '信息采集完成 ' + blocks.length + '/' + Math.max(urls.length + (manualText ? 1 : 0), blocks.length)
      } else {
        n.data.s = errors.length ? ('采集失败：' + errors[0]) : '信息采集失败'
      }
      return
    }

    if (n.type === 'analyze') {
      const txt = gD(n, 'transcribe')
      if (!txt) { n.data.s = '需要信息采集内容'; return }
      n.data.s = '分析中...'
      const isBrief = /^商单 BF|^BF brief|商单\s*BF/i.test(String(txt || '').trim())
      const d = await chatMinimax({
        model: 'gpt-5.5',
        prompt: isBrief ? buildBriefAnalyzePrompt(txt) : buildAnalyzePrompt(txt),
        system: isBrief
          ? '你只做商单 BF 策略拆解，返回简洁 Markdown，重点提炼要求、卖点、禁区和创作方向。'
          : '只做文案拆解，返回简洁 Markdown。不要输出可替换切入点，不要复述完整原文，不要输出 JSON。'
      })
      n.data.r = assertCleanModelReply(d.reply)
      n.data.s = n.data.r ? '分析完成' : '分析失败'
      return
    }

    if (n.type === 'hot') {
      const analysisTxt = gD(n, 'analyze')
      const transcribeTxt = gD(n, 'transcribe')
      const txt = analysisTxt || transcribeTxt
      const searchContext = [analysisTxt, transcribeTxt].filter(Boolean).join('\n\n')
      if (!txt) { n.data.s = '需要信息采集内容/analysis'; return }
      const typedQuery = String(n.data.query || '').trim()
      const autoQuery = String(n.data.autoQuery || '').trim()
      const manualQuery = typedQuery && typedQuery !== autoQuery ? typedQuery : ''
      let intent = { query: '', queries: [], entities: [], exclude_terms: [], intent_terms: [] }
      let searchPlan = null
      let searchQueries = []
      let fallbackQueries = []
      let kw = manualQuery
      if (!kw) {
        n.data.s = 'AI 规划背景搜索词...'
        searchPlan = await getWorkflowSearchPlanWithAI(analysisTxt, transcribeTxt || txt, 'hot')
        if (searchPlan) {
          searchQueries = searchPlan.primary
          fallbackQueries = searchPlan.fallback
          kw = searchQueries[0] || fallbackQueries[0] || ''
        }
      }
      if (!kw) {
        intent = await getSearchIntentQuery(searchContext || txt, 'hot')
        kw = pickHotSearchQuery('', intent, searchContext || txt)
      }
      if (!kw) { n.data.s = '没有提取到可用搜索词'; return }
      n.data.query = kw
      if (!manualQuery) n.data.autoQuery = kw
      n.data.search_intent = searchPlan
        ? { mode: 'ai_hot_plan', queries: searchQueries, fallback_queries: fallbackQueries, reason: searchPlan.reason || '' }
        : (manualQuery ? { mode: 'manual_hot_query', queries: [kw], entities: [], exclude_terms: [], intent_terms: [] } : intent)
      n.data.searchPlan = searchPlan
      n.data.searchQueries = searchQueries.length ? searchQueries : [kw]
      n.data.fallbackQueries = fallbackQueries
      n.data.s = '背景搜索中...'
      const d = await searchHot({ query: kw, source_text: (searchContext || txt).substring(0, 4000) })
      n.data.rs = d.results || []
      n.data.mode = d.mode || ''
      n.data.filteredResults = d.mode === 'web_research' ? n.data.rs : filterHotResultsBySourceText(n.data.rs, searchContext || txt, kw)
      n.data.analysis = d.analysis || ''
      n.data.query = d.query || kw
      if (!manualQuery) n.data.autoQuery = n.data.query
      n.data.source = d.source || ''
      n.data.filterNote = d.mode === 'web_research' ? '已使用模型原生联网搜索整理背景资料。' : '保留 ' + n.data.filteredResults.length + '/' + n.data.rs.length + ' 个与上游素材更相关的来源；低相关搜索结果不会进入后续汇总。'
      const fetchedCount = n.data.filteredResults.filter(r => r.content).length
      n.data.s = d.mode === 'web_research' ? '模型联网检索完成' : (n.data.analysis ? '已过滤 ' + n.data.filteredResults.length + '/' + n.data.rs.length + ' 个来源，抓取原文 ' + fetchedCount : '找到 ' + n.data.rs.length + ' 个来源')
      return
    }

    if (n.type === 'platform') {
      const analysisTxt = gD(n, 'analyze')
      const transcribeTxt = gD(n, 'transcribe')
      const txt = [analysisTxt, transcribeTxt].filter(Boolean).join('\n\n')
      if (!txt) { n.data.s = '需要信息采集内容/analysis'; return }
      const typedKeywords = String(n.data.keywords || '').trim()
      const autoKeywords = String(n.data.autoKeywords || '').trim()
      const manualKeywords = typedKeywords && typedKeywords !== autoKeywords ? typedKeywords : ''
      let intent = { query: '', queries: [], entities: [], exclude_terms: [], intent_terms: [] }
      let searchPlan = null
      let searchQueries = []
      let fallbackQueries = []
      let keywords = manualKeywords
      if (!keywords) {
        n.data.s = 'AI 规划B站搜索词...'
        searchPlan = await getWorkflowSearchPlanWithAI(analysisTxt, transcribeTxt || txt, 'platform')
        if (searchPlan) {
          searchQueries = searchPlan.primary
          fallbackQueries = searchPlan.fallback
          keywords = searchQueries[0] || fallbackQueries[0] || ''
        }
      }
      if (!keywords) {
        intent = await getSearchIntentQuery(txt, 'platform')
        keywords = (intent.query || pickSubjectFallbackQuery(txt, 4) || extractPlatformSearchQuery(txt) || extractPlatformKeywords(txt)).trim()
      }
      if (!keywords) { n.data.s = '没有提取到可用搜索词'; return }
      n.data.keywords = keywords
      if (!manualKeywords) n.data.autoKeywords = keywords
      n.data.search_intent = searchPlan
        ? { mode: 'ai_platform_plan', queries: searchQueries, fallback_queries: fallbackQueries, reason: searchPlan.reason || '' }
        : (manualKeywords ? { mode: 'manual_platform_query', queries: [keywords], entities: [], exclude_terms: [], intent_terms: [] } : intent)
      n.data.searchPlan = searchPlan
      n.data.searchQueries = searchQueries.length ? searchQueries : [keywords]
      n.data.fallbackQueries = fallbackQueries
      n.data.s = '搜索 B站候选中...'
      const d = await searchPlatform({ query: keywords, source_text: txt.substring(0, 4000), platforms: ['bilibili'], limit: 5, transcribe_limit: 3, dry_run: true })
      n.data.candidates = d.候选 || d.results || []
      n.data.selected = d.selected || n.data.candidates.filter(r => r.selected).slice(0, 3)
      n.data.rs = n.data.selected
      n.data.s = d.enabled ? 'B站 候选 ' + n.data.candidates.length + '  · 转写 ' + n.data.selected.length + '/3' : 'B站模块已就绪，保留 Top 3 转写位'
      return
    }

    if (n.type === 'vec') {
      const analysisTxt = gD(n, 'analyze')
      const transcribeTxt = gD(n, 'transcribe')
      const txt = [analysisTxt, transcribeTxt].filter(Boolean).join('\n\n')
      if (!txt) { n.data.s = '需要信息采集内容'; return }
      n.data.s = '规划向量检索词...'
      const typedQuery = String(n.data.query || '').trim()
      const autoQuery = String(n.data.autoQuery || '').trim()
      const manualQuery = typedQuery && typedQuery !== autoQuery ? typedQuery : ''
      let intent = { query: '', queries: [], entities: [], exclude_terms: [], intent_terms: [] }
      let vectorPlan = null
      let queries = []
      let fallbackQueries = []
      if (manualQuery) {
        queries = pickVectorSearchQueries(manualQuery, intent, txt)
      } else {
        n.data.s = 'AI 规划向量检索词...'
        vectorPlan = await getVectorSearchPlanWithAI(analysisTxt, transcribeTxt || txt)
        if (vectorPlan) {
          queries = vectorPlan.primary
          fallbackQueries = vectorPlan.fallback
        }
        if (!queries.length && !fallbackQueries.length) {
          intent = await getSearchIntentQuery(txt, 'vector')
          queries = pickVectorSearchQueries('', intent, txt)
          fallbackQueries = pickVectorFallbackQueries(intent, txt)
        }
      }
      if (!queries.length && !fallbackQueries.length) { n.data.s = '没有提取到可用搜索词'; return }
      n.data.search_intent = vectorPlan
        ? { mode: 'ai_vector_plan', queries, fallback_queries: fallbackQueries, reason: vectorPlan.reason || '' }
        : intent
      n.data.vectorPlan = vectorPlan
      n.data.searchQueries = queries
      n.data.fallbackQueries = fallbackQueries
      n.data.query = (queries.length ? queries : fallbackQueries).join(' / ')
      if (!manualQuery) n.data.autoQuery = n.data.query
      n.data.s = '向量搜索中：' + (queries.length ? queries.join(' / ') : fallbackQueries.join(' / '))
      let searchState = await searchVectorQuerySet(queries, manualQuery ? '手动检索' : '主题匹配')
      let usedFallback = false
      if (!searchState.results.length && fallbackQueries.length) {
        n.data.s = '主题未强匹配，尝试表达兜底：' + fallbackQueries.join(' / ')
        const fallbackState = await searchVectorQuerySet(fallbackQueries, '表达兜底（题材未强匹配）')
        searchState = {
          results: fallbackState.results,
          errors: searchState.errors.concat(fallbackState.errors)
        }
        usedFallback = Boolean(searchState.results.length)
      }
      const merged = searchState.results
      n.data.rs = filterVectorResults(merged, 2)
      n.data.s = n.data.rs.length
        ? (usedFallback ? '表达兜底 ' : '表达参考 ') + n.data.rs.length + ' 条 · 检索 ' + (usedFallback ? fallbackQueries.length : queries.length) + ' 组'
        : (searchState.errors.length ? '向量搜索失败：' + searchState.errors[0] : '未找到高相关表达参考，后续以原文为主')
      return
    }

    if (n.type === 'sum') {
      n.data.txt = bR(n)
      n.data.s = n.data.txt ? '汇总报告已生成' : '没有上游内容'
      return
    }

    if (n.type === 'idea') {
      const rep = gD(n, 'sum')
      if (!rep) { n.data.s = '需要汇总报告'; return }
      n.data.s = '生成创意中...'
      const d = await chatMinimax({ model: 'gpt-5.5', prompt: buildIdeaPrompt(rep), system: '只返回 3 行创意方向，每行包含切入点、框架、论据，不要生成完整文案。' })
      n.data.list = normalizeIdeaRows(d.reply)
      const cards = createIdeaCards(n)
      if (cards[0]) sel.value = cards[0].id
      n.data.s = '创意已生成 ' + n.data.list.length
      return
    }

    if (n.type === 'gen') {
      const rep = gD(n, 'sum')
      const sourceText = gD(n, 'transcribe') || upstreamText(n, ['input'], { max: 9000 })
      const idea = pickIval(n)
      if (!sourceText || !idea) { n.data.s = '需要原文 and selected idea'; return }
      if (!n.data.styleConfirmed && !n.data.styleRef) n.data.styleSkipped = true
      n.data.s = '生成文案中...'
      const styleRef = n.data.styleSkipped ? null : n.data.styleRef
      const d = await withTimeout(
        chatMinimax({
          model: n.data.mdl === 'Kimi' ? 'Kimi K2.5' : 'gpt-5.5',
          prompt: buildIdeaCardCopyPrompt(sourceText, rep, idea, n.data.words, styleRef),
          system: '根据原文和已确认的切入点、框架、论据生成中文短视频成稿，只返回正文。',
          ...copyModelOptions(n.data.words, 'draft')
        }),
        copyModelOptions(n.data.words, 'draft').timeoutMs + 30000,
        '生成文案'
      ).catch((e) => { throw e })
      const firstDraft = d.reply || ''
      if (looksLikeModelError(firstDraft)) {
        const modelError = String(firstDraft || '').replace(/^error\s*:\s*/i, '')
        throw new Error(modelError || 'AI request failed')
      }
      n.data.s = '自检修稿中...'
      const checked = await withTimeout(
        chatMinimax({
          model: n.data.mdl === 'Kimi' ? 'Kimi K2.5' : 'gpt-5.5',
          prompt: buildCopySelfCheckPrompt(firstDraft, sourceText, rep, idea, n.data.words),
          system: '你只做文案自检和修稿，直接输出修订后的最终正文。',
          ...copyModelOptions(n.data.words, 'selfcheck')
        }),
        copyModelOptions(n.data.words, 'selfcheck').timeoutMs + 30000,
        '自检修稿'
      )
      n.data.out = checked.reply || firstDraft || '生成失败'
      if (looksLikeModelError(n.data.out)) {
        const modelError = String(n.data.out || '').replace(/^error\s*:\s*/i, '')
        n.data.out = ''
        throw new Error(modelError || 'AI request failed')
      }
      n.data.s = '文案已生成'
      return
    }
  } catch (e) {
    n.data.s = 'error: ' + e.message
  } finally {
    n.run = false
    ctx.active.delete(n.id)
    if (options.auto !== false && canAutoContinue(n)) {
      await runDownstream(n, ctx)
    }
  }
}

function reset() {
  nID = 1
  nodes.value = []
  lines.value = []
  hoverPort.value = null
  sel.value = null
  ctx.show = false

  const layout = [
    ['input', 96, 260],
    ['transcribe', 420, 260],
    ['analyze', 744, 260],
    ['hot', 1080, 48],
    ['platform', 1080, 260],
    ['vec', 1080, 472],
    ['sum', 1416, 260],
    ['idea', 1740, 260],
  ]
  layout.forEach(([type, x, y]) => nodes.value.push(mk(type, x, y)))

  const byType = Object.fromEntries(nodes.value.map(n => [n.type, n]))
  addL(byType.input, 0, byType.transcribe, 0)
  addL(byType.transcribe, 0, byType.analyze, 0)
  addL(byType.analyze, 0, byType.hot, 0)
  addL(byType.analyze, 0, byType.platform, 0)
  addL(byType.analyze, 0, byType.vec, 0)
  addL(byType.hot, 0, byType.sum, 0)
  addL(byType.platform, 0, byType.sum, 1)
  addL(byType.vec, 0, byType.sum, 2)
  addL(byType.sum, 0, byType.idea, 0)

  nextTick(fitView)
}

function applyWorkflowPrefillUrl(url) {
  const clean = extractWorkflowUrl(url || '') || String(url || '').trim()
  if (!clean) return false
  const input = nodes.value.find(n => n.type === 'input')
  if (!input?.data) return false
  input.data.url = clean
  input.data.idea = ''
  input.data.sourceType = 'video'
  input.data.s = '链接已带入，点击运行'
  sel.value = input.id
  nextTick(fitView)
  return true
}

function consumeWorkflowPrefillUrl() {
  if (typeof window === 'undefined') return
  try {
    const url = localStorage.getItem(WORKFLOW_PREFILL_URL_KEY)
    if (!url) return
    localStorage.removeItem(WORKFLOW_PREFILL_URL_KEY)
    applyWorkflowPrefillUrl(url)
  } catch (e) {}
}

function handleWorkflowPrefill(event) {
  applyWorkflowPrefillUrl(event?.detail?.url || '')
}

reset()
onMounted(() => {
  loadStyles()
  consumeWorkflowPrefillUrl()
  window.addEventListener('usagi:workflow-prefill', handleWorkflowPrefill)
})
onUnmounted(() => {
  stopWindowDrag()
  window.removeEventListener('usagi:workflow-prefill', handleWorkflowPrefill)
})

function onDetailPointerUp(event) {
  if (!event.target?.classList?.contains('wf-side-text')) return
  setTimeout(() => captureDetailSelection(event), 0)
}

function onDetailKeyUp(event) {
  if (!event.target?.classList?.contains('wf-side-text')) return
  captureDetailSelection(event)
}

function onDetailContextMenu(event) {
  if (!event.target?.classList?.contains('wf-side-text')) return
  if (maybeOpenAiAnnotator(event)) event.preventDefault()
}

if (typeof window !== 'undefined') {
  window.addEventListener('mouseup', onDetailPointerUp)
  window.addEventListener('keyup', onDetailKeyUp)
  window.addEventListener('contextmenu', onDetailContextMenu, true)
}

onUnmounted(() => {
  if (typeof window === 'undefined') return
  window.removeEventListener('mouseup', onDetailPointerUp)
  window.removeEventListener('keyup', onDetailKeyUp)
  window.removeEventListener('contextmenu', onDetailContextMenu, true)
})
</script>

<style scoped>
.wf-module {
  --wf-bg: #0d0b18;
  --wf-canvas-bg: #0f0d1d;
  --wf-node-bg-readable: #171426;
  --wf-node-border-readable: rgba(167, 139, 250, 0.22);
  --wf-subtle-solid: #211d35;
  --wf-input-solid: #111827;
  --wf-floating-solid: #171426;
  --wf-button-bg: #222738;
  --wf-button-bg-hover: #2b3246;
  --wf-button-border: rgba(148, 163, 184, 0.24);
  --wf-button-border-hover: rgba(148, 163, 184, 0.42);
  --wf-button-text: #cbd5e1;
  --wf-button-text-strong: #f8fafc;
  --wf-primary-bg: linear-gradient(135deg, #0f766e, #2563eb);
  --wf-primary-bg-hover: linear-gradient(135deg, #0d9488, #3b82f6);
  --wf-primary-border: rgba(94, 234, 212, 0.46);
  --wf-primary-text: #f8fafc;
  --wf-feishu-bg: #1d2836;
  --wf-feishu-bg-hover: #243447;
  --wf-feishu-text-hover: #67e8f9;
  --wf-run-solid: linear-gradient(135deg, #22c55e, #14b8a6);
  --wf-run-solid-hover: linear-gradient(135deg, #4ade80, #2dd4bf);
  --wf-run-border-solid: rgba(134, 239, 172, 0.58);
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--wf-bg);
}

:global(:root[data-ui-style="apple"] .wf-module) {
  --wf-bg: #f3f6fb;
  --wf-canvas-bg: #f7f9fc;
  --wf-node-bg-readable: #ffffff;
  --wf-node-border-readable: rgba(38, 52, 74, 0.16);
  --wf-subtle-solid: #f3f6fb;
  --wf-input-solid: #ffffff;
  --wf-floating-solid: #ffffff;
  --wf-button-bg: #eef3f8;
  --wf-button-bg-hover: #e5edf6;
  --wf-button-border: rgba(38, 52, 74, 0.16);
  --wf-button-border-hover: rgba(37, 99, 235, 0.28);
  --wf-button-text: #475569;
  --wf-button-text-strong: #0f172a;
  --wf-primary-bg: linear-gradient(135deg, #0f766e, #2563eb);
  --wf-primary-bg-hover: linear-gradient(135deg, #0d9488, #1d4ed8);
  --wf-primary-border: rgba(37, 99, 235, 0.32);
  --wf-primary-text: #ffffff;
  --wf-feishu-bg: #edf7f8;
  --wf-feishu-bg-hover: #dff3f5;
  --wf-feishu-text-hover: #0f766e;
  --wf-run-solid: linear-gradient(135deg, #16a34a, #0f9f8f);
  --wf-run-solid-hover: linear-gradient(135deg, #15803d, #0f766e);
  --wf-run-border-solid: rgba(21, 128, 61, 0.46);
}

:global(:root[data-ui-style="usagi"] .wf-module) {
  --wf-bg: #f3e6cf;
  --wf-canvas-bg: #f6ead2;
  --wf-node-bg-readable: rgba(255, 251, 241, 0.96);
  --wf-node-border-readable: rgba(110, 72, 47, 0.18);
  --wf-subtle-solid: rgba(239, 222, 190, 0.7);
  --wf-input-solid: rgba(255, 255, 250, 0.94);
  --wf-floating-solid: rgba(255, 251, 241, 0.9);
  --wf-button-bg: rgba(250, 239, 214, 0.92);
  --wf-button-bg-hover: rgba(244, 225, 190, 0.96);
  --wf-button-border: rgba(110, 72, 47, 0.16);
  --wf-button-border-hover: rgba(177, 119, 28, 0.28);
  --wf-button-text: #735442;
  --wf-button-text-strong: #4a3024;
  --wf-primary-bg: linear-gradient(135deg, #e8c56a, #d79e3b);
  --wf-primary-bg-hover: linear-gradient(135deg, #edd383, #cc9132);
  --wf-primary-border: rgba(177, 119, 28, 0.32);
  --wf-primary-text: #4a3024;
  --wf-feishu-bg: rgba(104, 214, 182, 0.16);
  --wf-feishu-bg-hover: rgba(104, 214, 182, 0.24);
  --wf-feishu-text-hover: #1f8a6a;
  --wf-run-solid: linear-gradient(135deg, #67b99e, #d79e3b);
  --wf-run-solid-hover: linear-gradient(135deg, #79c8ae, #cc9132);
  --wf-run-border-solid: rgba(31, 138, 106, 0.32);
}

:global(:root[data-ui-style="violet"] .wf-module) {
  --wf-bg: #111323;
  --wf-canvas-bg: #0f1324;
  --wf-node-bg-readable: #171b2f;
  --wf-node-border-readable: rgba(148, 163, 184, 0.24);
  --wf-subtle-solid: #20243a;
  --wf-input-solid: #111827;
  --wf-floating-solid: #171b2f;
  --wf-button-bg: #22283a;
  --wf-button-bg-hover: #2b3348;
  --wf-button-border: rgba(148, 163, 184, 0.24);
  --wf-button-border-hover: rgba(94, 234, 212, 0.38);
  --wf-button-text: #cbd5e1;
  --wf-button-text-strong: #f8fafc;
  --wf-primary-bg: linear-gradient(135deg, #0f766e, #2563eb);
  --wf-primary-bg-hover: linear-gradient(135deg, #0d9488, #3b82f6);
  --wf-primary-border: rgba(94, 234, 212, 0.46);
  --wf-primary-text: #f8fafc;
  --wf-feishu-bg: #1f2937;
  --wf-feishu-bg-hover: #273549;
  --wf-feishu-text-hover: #67e8f9;
  --wf-run-solid: linear-gradient(135deg, #22c55e, #14b8a6);
  --wf-run-solid-hover: linear-gradient(135deg, #4ade80, #2dd4bf);
  --wf-run-border-solid: rgba(134, 239, 172, 0.58);
}

.wf-hdr {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  min-height: 44px;
  padding: 0;
  border-bottom: 0;
  background: transparent;
}

.wf-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.wf-title-mark {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-bright);
  border-radius: 8px;
  background: var(--active-bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

.wf-title h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 750;
  line-height: 1.2;
  color: var(--text);
}

.wf-hdr-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-muted);
}

.wf-hdr-r {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.wf-zoom-text {
  min-width: 44px;
  text-align: center;
  font-size: 12px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.wf-icon-btn {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid var(--wf-button-border);
  border-radius: 8px;
  background: var(--wf-button-bg);
  color: var(--wf-button-text);
  cursor: pointer;
  font-size: 14px;
  transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease, transform 0.16s ease;
}

.wf-icon-btn:hover {
  border-color: var(--wf-button-border-hover);
  background: var(--wf-button-bg-hover);
  color: var(--wf-button-text-strong);
}

.wf-canvas {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  user-select: none;
  cursor: grab;
  background-color: var(--wf-canvas-bg);
  background-image:
    linear-gradient(var(--wf-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--wf-grid-line) 1px, transparent 1px);
}

.wf-canvas.panning {
  cursor: grabbing;
}

.wf-canvas.connecting {
  cursor: crosshair;
}

.wf-world {
  position: absolute;
  top: 0;
  left: 0;
  width: 3200px;
  height: 1800px;
  transform-origin: 0 0;
}

.wf-svg {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}

.wf-line {
  fill: none;
  stroke: url(#wf-line-grad);
  stroke-width: 2.4px;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
  filter: var(--wf-line-shadow);
}

.wf-line-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 16px;
  stroke-linecap: round;
  pointer-events: stroke;
  cursor: pointer;
}

.wf-line-group:hover .wf-line {
  stroke: var(--danger-text);
  filter: drop-shadow(0 0 9px var(--danger-border));
}

.wf-line-draft {
  stroke: var(--wf-line-a);
  stroke-dasharray: 7 5;
  marker-end: url(#wf-arr);
}

.wf-line-draft.ok {
  stroke: var(--wf-line-c);
}

.wf-node {
  --node-accent: var(--wf-node-default);
  position: absolute;
  width: 268px;
  min-height: 168px;
  overflow: visible;
  cursor: move;
  filter: var(--wf-node-shadow);
  transition: filter 0.18s ease;
}

.wf-node.input { --node-accent: var(--wf-node-input); }
.wf-node.transcribe { --node-accent: var(--wf-node-transcribe); }
.wf-node.analyze { --node-accent: var(--wf-node-analyze); }
.wf-node.hot { --node-accent: var(--wf-node-hot); }
.wf-node.platform { --node-accent: #14b8a6; }
.wf-node.vec { --node-accent: var(--wf-node-vec); }
.wf-node.sum { --node-accent: var(--wf-node-sum); }
.wf-node.idea { --node-accent: var(--wf-node-idea); }
.wf-node.ideaCard { --node-accent: var(--wf-node-idea); }
.wf-node.gen { --node-accent: var(--wf-node-gen); }

.wf-node.ideaCard {
  width: 304px;
  min-height: 222px;
}

.wf-node.ideaCard .wf-node-body {
  min-height: 222px;
  border-color: color-mix(in srgb, var(--wf-node-idea) 42%, var(--wf-node-border-readable));
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 42%),
    color-mix(in srgb, var(--wf-node-idea) 8%, var(--wf-node-bg-readable));
}

.wf-node.ideaCard .wf-nbd {
  gap: 9px;
}

.wf-platform-meta {
  margin: 6px 0;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--node-accent) 30%, var(--border));
  border-radius: 6px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
  background: color-mix(in srgb, var(--node-accent) 10%, var(--wf-subtle-solid));
}

.wf-platform-candidates {
  display: grid;
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
  padding-right: 2px;
}

.wf-platform-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
  gap: 8px;
}

.wf-platform-candidate {
  display: grid;
  gap: 4px;
  padding: 9px;
  border: 1px solid var(--chip-border);
  border-radius: 8px;
  background: var(--wf-subtle-bg);
  cursor: pointer;
}

.wf-platform-candidate.selected {
  border-color: color-mix(in srgb, #14b8a6 55%, var(--border));
  background: color-mix(in srgb, #14b8a6 12%, var(--wf-subtle-solid));
}

.wf-platform-candidate.running {
  border-color: color-mix(in srgb, #38bdf8 62%, var(--border));
}

.wf-platform-candidate.done {
  border-color: color-mix(in srgb, #22c55e 62%, var(--border));
}

.wf-platform-candidate.error {
  border-color: color-mix(in srgb, #fb7185 62%, var(--border));
}

.wf-platform-candidate b {
  color: var(--primary-light);
  font-size: 11px;
}

.wf-platform-candidate span {
  color: var(--text);
  font-size: 12px;
  line-height: 1.35;
}

.wf-platform-candidate em {
  color: var(--text-muted);
  font-size: 11px;
  font-style: normal;
}

.wf-node:hover,
.wf-node.sel {
  z-index: 20;
  filter: var(--wf-node-shadow-hover);
}

.wf-node.sel .wf-node-body {
  border-color: color-mix(in srgb, var(--node-accent) 72%, white 0%);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--node-accent) 38%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.wf-node-body {
  min-height: 168px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 8px;
  background:
    var(--wf-node-sheen),
    var(--wf-node-bg);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
  position: relative;
}

.wf-nhdr {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 46px;
  padding: 10px 12px 9px;
  border-top: 3px solid var(--node-accent);
  border-bottom: 1px solid var(--border);
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--node-accent) 12%, transparent), transparent 74%),
    var(--wf-subtle-bg);
}

.wf-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  border: 1px solid color-mix(in srgb, var(--node-accent) 42%, var(--border));
  background: color-mix(in srgb, var(--node-accent) 14%, var(--wf-subtle-bg));
  color: var(--text);
  flex-shrink: 0;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

.wf-icon svg,
.wf-palette-icon,
.wf-menu-icon,
.module-page-svg-icon svg {
  width: 17px;
  height: 17px;
  display: block;
}

.wf-icon path,
.wf-palette-icon path,
.wf-menu-icon path,
.module-page-svg-icon path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.wf-nn {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-st {
  width: 9px;
  height: 9px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #64748b;
  box-shadow: 0 0 0 4px rgba(100, 116, 139, 0.12);
}

.wf-st.running {
  background: #38bdf8;
  box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.16), 0 0 14px rgba(56, 189, 248, 0.65);
  animation: wfPulse 1.2s ease-in-out infinite;
}

.wf-st.done {
  background: #22c55e;
  box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.14);
}

.wf-st.pending {
  background: #f59e0b;
  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.14);
}

.wf-st.error {
  background: #fb7185;
  box-shadow: 0 0 0 4px rgba(251, 113, 133, 0.14);
}

.wf-nbd {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}

.wf-s {
  min-height: 26px;
  padding: 6px 9px;
  border: 1px solid var(--chip-border);
  border-radius: 7px;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--node-accent) 9%, transparent), transparent),
    var(--wf-subtle-bg);
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-i {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  resize: none;
  background: var(--wf-input-bg);
  color: var(--text);
  font-size: 12px;
  line-height: 1.45;
  padding: 8px 9px;
  font-family: inherit;
  box-sizing: border-box;
}

.wf-i:focus {
  border-color: var(--border-bright);
  box-shadow: 0 0 0 2px var(--focus-ring);
}

.wf-source-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.wf-source-tabs button {
  min-height: 28px;
  border: 1px solid var(--wf-button-border);
  border-radius: 8px;
  background: var(--wf-button-bg);
  color: var(--wf-button-text);
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  font-weight: 850;
  letter-spacing: 0.02em;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.wf-source-tabs button:hover {
  border-color: var(--wf-button-border-hover);
  color: var(--wf-button-text-strong);
  background: var(--wf-button-bg-hover);
}

.wf-source-tabs button.active {
  border-color: var(--wf-primary-border);
  background: var(--wf-primary-bg);
  color: var(--wf-primary-text);
  box-shadow: 0 8px 18px rgba(15, 118, 110, 0.16);
}

.wf-hidden-file {
  display: none;
}

.wf-doc-drop,
.wf-side-doc-drop {
  border: 1px dashed color-mix(in srgb, var(--wf-node-input) 48%, var(--border));
  border-radius: 10px;
  background: color-mix(in srgb, var(--wf-node-input) 8%, var(--wf-input-bg));
  color: var(--text-muted);
}

.wf-doc-drop {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 34px;
  padding: 6px 7px;
  font-size: 11px;
}

.wf-side-doc-drop {
  display: grid;
  gap: 7px;
  padding: 12px;
  font-size: 12px;
}

.wf-side-doc-drop strong {
  color: var(--text);
  font-size: 13px;
}

.wf-doc-drop.dragging,
.wf-side-doc-drop.dragging,
.wf-doc-drop.busy,
.wf-side-doc-drop.busy {
  border-color: var(--wf-node-input);
  background: color-mix(in srgb, var(--wf-node-input) 15%, var(--wf-input-bg));
}

.wf-preview {
  min-height: 52px;
  max-height: 78px;
  overflow-y: auto;
  cursor: zoom-in;
}

.wf-node.input .wf-node-body,
.wf-node.transcribe .wf-node-body,
.wf-node.sum .wf-node-body {
  min-height: 150px;
}

.wf-node.input .wf-nbd,
.wf-node.transcribe .wf-nbd,
.wf-node.sum .wf-nbd {
  min-height: 104px;
}

.wf-node.input .wf-nbd::after,
.wf-node.transcribe .wf-nbd::after,
.wf-node.sum .wf-nbd::after {
  display: block;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px dashed var(--chip-border);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.35;
}

.wf-node.input .wf-nbd::after {
  content: "Paste one or more source links";
}

.wf-node.transcribe .wf-nbd::after {
  content: "Batch transcript output";
}

.wf-node.sum .wf-nbd::after {
  content: "Merged report context";
}

.wf-node.input .wf-i:first-child {
  min-height: 34px;
}

.wf-node.input textarea.wf-i {
  min-height: 50px;
}

.wf-port {
  position: absolute;
  width: 14px;
  height: 14px;
  border: 2px solid var(--node-accent);
  border-radius: 50%;
  background: var(--wf-canvas-bg);
  cursor: crosshair;
  z-index: 25;
  transform: translateY(-50%);
  transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.wf-port:hover,
.wf-port.used,
.wf-port.target {
  background: var(--node-accent);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--node-accent) 18%, transparent);
}

.wf-port:hover,
.wf-port.target {
  transform: translateY(-50%) scale(1.18);
}

.wf-port-in {
  left: -7px;
}

.wf-port-out {
  right: -7px;
}

.wf-port-name {
  position: absolute;
  top: 50%;
  left: 19px;
  transform: translateY(-50%);
  display: none;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  pointer-events: none;
}

.wf-port-name-out {
  left: auto;
  right: 19px;
}

.wf-btns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.wf-ri-list,
.wf-ideas {
  display: flex;
  flex-direction: column;
  gap: 5px;
  overflow: hidden;
}

.wf-ri-list {
  max-height: 68px;
}

.wf-ri {
  min-height: 24px;
  padding: 5px 7px;
  border: 1px solid var(--chip-border);
  border-radius: 7px;
  background: var(--wf-subtle-bg);
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-ideas {
  max-height: 92px;
  overflow-y: auto;
}

.wf-icard {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 5px 6px;
  border: 1px solid var(--chip-border);
  border-radius: 7px;
  background: var(--wf-subtle-bg);
}

.wf-icard.picked {
  border-color: var(--border-bright);
  background: var(--accent-soft);
}

.wf-in {
  min-width: 16px;
  color: var(--node-accent);
  font-size: 11px;
  font-weight: 800;
}

.wf-it {
  flex: 1;
  min-width: 0;
  color: var(--text-dim);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-idea-card-title {
  display: grid;
  gap: 5px;
  padding: 9px 10px;
  border: 1px solid color-mix(in srgb, var(--node-accent) 36%, var(--chip-border));
  border-radius: 9px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--node-accent) 16%, transparent), rgba(255, 255, 255, 0.03)),
    var(--wf-subtle-bg);
  color: var(--text);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.wf-idea-card-title span {
  color: color-mix(in srgb, var(--node-accent) 78%, var(--text-muted));
  font-size: 10px;
  font-weight: 900;
}

.wf-idea-card-title b {
  font-size: 13px;
  font-weight: 800;
  line-height: 1.35;
}

.wf-idea-card-points {
  display: grid;
  gap: 6px;
}

.wf-idea-card-meta {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 7px;
  align-items: start;
  padding: 7px 8px;
  border: 1px solid var(--chip-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--wf-subtle-bg) 86%, transparent);
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.45;
}

.wf-idea-card-meta b {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 900;
}

.wf-idea-card-meta span {
  min-width: 0;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.wf-idea-card-text {
  max-height: 58px;
  overflow: hidden;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
}

.wf-idea-style-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 9px;
  border: 1px solid color-mix(in srgb, #f59e0b 58%, var(--chip-border));
  border-radius: 9px;
  background:
    linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(255, 255, 255, 0.04)),
    color-mix(in srgb, #f59e0b 7%, var(--wf-subtle-bg));
  color: color-mix(in srgb, #fbbf24 70%, var(--text));
  font-size: 12px;
  font-weight: 850;
}

.wf-idea-style-copy {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.wf-idea-style-copy b {
  color: inherit;
  font-size: 10px;
  font-weight: 900;
  line-height: 1.2;
  letter-spacing: 0;
  text-transform: uppercase;
}

.wf-idea-style-line.chosen {
  border-color: color-mix(in srgb, var(--success-text) 52%, var(--chip-border));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--success-text) 16%, transparent), rgba(255, 255, 255, 0.04)),
    var(--wf-subtle-bg);
  color: var(--success-text);
}

.wf-idea-style-line span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-nx {
  position: absolute;
  top: -9px;
  right: -9px;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 1px solid var(--danger-border);
  border-radius: 50%;
  background: var(--danger-bg);
  color: var(--danger-text);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  opacity: 0;
  transition: opacity 0.16s ease, transform 0.16s ease;
  z-index: 30;
}

.wf-node:hover .wf-nx,
.wf-node.sel .wf-nx {
  opacity: 1;
}

.wf-nx:hover {
  transform: scale(1.08);
}

.wf-type-tag {
  position: absolute;
  bottom: -20px;
  left: 12px;
  padding: 4px 8px;
  border: 1px solid var(--chip-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--node-accent) 10%, var(--wf-input-bg));
  color: color-mix(in srgb, var(--node-accent) 82%, white 0%);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease;
}

.wf-node:hover .wf-type-tag,
.wf-node.sel .wf-type-tag {
  opacity: 1;
}

.wf-palette,
.wf-zoom {
  position: absolute;
  z-index: 80;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--wf-floating-bg);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
}

.wf-palette {
  top: 14px;
  left: 14px;
  display: grid;
  gap: 5px;
  padding: 7px;
}

.wf-palette-btn {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 7px;
  background: var(--wf-subtle-bg);
  cursor: pointer;
  color: var(--text);
  transition: border-color 0.16s ease, background 0.16s ease;
}

.wf-palette-btn:hover {
  border-color: var(--border-bright);
  background: var(--active-bg);
}

.wf-zoom {
  right: 14px;
  bottom: 14px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px;
  color: var(--text-dim);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.wf-zoom span {
  min-width: 42px;
  text-align: center;
}

.wf-ctx {
  position: absolute;
  z-index: 100;
  min-width: 176px;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--wf-menu-bg);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
}

.ctx-hit {
  padding: 8px 10px;
  border-radius: 7px;
  color: var(--text);
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s ease, color 0.15s ease;
}

.ctx-hit:hover {
  background: var(--active-bg);
}

.ctx-hit.danger {
  color: var(--danger-text);
}

.ctx-hit.danger:hover {
  background: var(--danger-bg);
}

.ctx-div {
  height: 1px;
  margin: 5px 0;
  background: var(--chip-border);
}

.ctx-lbl {
  padding: 5px 10px 4px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0;
}

.btn {
  border: 1px solid var(--wf-button-border);
  border-radius: 8px;
  background: var(--wf-button-bg);
  color: var(--wf-button-text);
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  padding: 7px 12px;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease, opacity 0.15s ease;
}

.btn:hover {
  border-color: var(--wf-button-border-hover);
  background: var(--wf-button-bg-hover);
  color: var(--wf-button-text-strong);
}

.btn-sm {
  padding: 7px 11px;
}

.btn-xs {
  min-height: 28px;
  padding: 6px 9px;
  font-size: 11px;
  border-radius: 8px;
}

.btn-ghost,
.btn-soft,
.btn-gst {
  color: var(--wf-button-text);
}

.btn-pri {
  border-color: var(--wf-primary-border);
  background: var(--wf-primary-bg);
  color: var(--wf-primary-text);
  box-shadow: 0 8px 18px rgba(15, 118, 110, 0.18);
}

.btn-pri:hover {
  border-color: var(--wf-primary-border);
  background: var(--wf-primary-bg-hover);
  color: var(--wf-primary-text);
}

.btn-run {
  width: 100%;
  border-color: var(--wf-run-border-solid);
  background: var(--wf-run-solid);
  color: #fff;
  box-shadow: var(--wf-run-shadow);
  margin-top: 2px;
}

.btn-run:hover {
  border-color: var(--wf-run-border-solid);
  background: var(--wf-run-solid-hover);
}

.btn-run:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.wf-node.input .wf-nbd > .btn-run,
.wf-node.sum .wf-nbd > .btn-run {
  display: none;
}

.btn-feishu {
  width: 100%;
  border-color: var(--wf-button-border);
  background: var(--wf-feishu-bg);
  color: var(--wf-button-text);
}

.btn-feishu:hover {
  border-color: var(--wf-button-border-hover);
  background: var(--wf-feishu-bg-hover);
  color: var(--wf-feishu-text-hover);
}

.wf-side {
  position: fixed;
  top: 84px;
  right: 18px;
  bottom: 18px;
  z-index: 170;
  width: min(440px, calc(100vw - 36px));
  box-sizing: border-box;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--wf-floating-bg);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(18px) saturate(1.15);
  -webkit-backdrop-filter: blur(18px) saturate(1.15);
  padding: 14px;
  overflow: hidden;
}

.wf-plan {
  position: fixed;
  top: 78px;
  left: max(256px, 6vw);
  right: max(28px, 4vw);
  bottom: 24px;
  z-index: 182;
  width: auto;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, .65fr);
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 14px;
  border: 1px solid var(--card-border, var(--border));
  border-radius: 14px;
  background:
    radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--primary) 16%, transparent), transparent 38%),
    var(--card-bg, var(--wf-floating-bg));
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(18px) saturate(1.12);
  -webkit-backdrop-filter: blur(18px) saturate(1.12);
  padding: 14px;
  overflow: hidden;
}

.wf-plan-head,
.wf-plan-output-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.wf-plan-head,
.wf-plan-card,
.wf-plan-actions {
  grid-column: 1 / -1;
}

.wf-plan-head small {
  display: block;
  margin-top: 4px;
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 600;
}

.wf-plan-head span,
.wf-plan-kicker,
.wf-plan-output-head span {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .08em;
}

.wf-plan-head h3,
.wf-plan-card h4 {
  margin: 2px 0 0;
  color: var(--text);
}

.wf-plan-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
}

.wf-plan-steps button {
  display: grid;
  gap: 5px;
  justify-items: center;
  border: 1px solid var(--chip-border);
  border-radius: 10px;
  background: var(--row-bg, var(--wf-subtle-bg));
  color: var(--text-dim);
  padding: 8px 4px;
  cursor: pointer;
}

.wf-plan-steps b {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--wf-input-bg);
  color: var(--text);
}

.wf-plan-steps span {
  font-size: 11px;
  font-weight: 800;
}

.wf-plan-steps button.active,
.wf-plan-steps button.done {
  border-color: color-mix(in srgb, var(--primary) 48%, var(--border));
  background: color-mix(in srgb, var(--primary) 12%, var(--row-bg, transparent));
}

.wf-plan-card {
  display: grid;
  gap: 5px;
  border: 1px solid color-mix(in srgb, var(--primary) 24%, var(--border));
  border-radius: 12px;
  background: var(--wf-subtle-solid);
  padding: 12px;
}

.wf-plan-card p {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.55;
}

.wf-plan-output {
  grid-column: 2;
  grid-row: 3;
}

.wf-plan-input,
.wf-plan-draft {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--input-border, var(--border));
  border-radius: 10px;
  outline: none;
  resize: none;
  background: var(--input-bg, var(--wf-input-bg));
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.65;
  padding: 11px;
}

.wf-plan-output {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
}

.wf-plan-chat {
  grid-column: 1;
  grid-row: 3;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
  padding-right: 4px;
}

.wf-plan-empty {
  display: grid;
  gap: 8px;
  border: 1px dashed var(--chip-border);
  border-radius: 12px;
  background: var(--wf-subtle-solid);
  padding: 12px;
}

.wf-plan-empty b {
  color: var(--text);
  font-size: 13px;
}

.wf-plan-empty button,
.wf-plan-options button {
  text-align: left;
  border: 1px solid var(--chip-border);
  border-radius: 10px;
  background: var(--input-bg, var(--wf-input-bg));
  color: var(--text);
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
  padding: 9px 10px;
  cursor: pointer;
}

.wf-plan-empty button:hover,
.wf-plan-options button:hover {
  border-color: color-mix(in srgb, var(--primary) 42%, var(--border));
  background: color-mix(in srgb, var(--primary) 10%, var(--input-bg, transparent));
}

.wf-plan-msg {
  display: grid;
  gap: 6px;
  align-self: stretch;
  border: 1px solid var(--chip-border);
  border-radius: 14px;
  background: var(--row-bg, var(--wf-subtle-bg));
  padding: 10px 12px;
}

.wf-plan-msg.user {
  margin-left: 36px;
  background: color-mix(in srgb, var(--primary) 10%, var(--row-bg, transparent));
}

.wf-plan-msg.assistant {
  margin-right: 22px;
}

.wf-plan-msg-role {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 900;
}

.wf-plan-msg p {
  margin: 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
}

.wf-plan-options {
  display: grid;
  gap: 7px;
  margin-top: 4px;
}

.wf-plan-draft {
  min-height: 0;
  height: 100%;
}

.wf-plan-actions {
  display: grid;
  grid-template-columns: minmax(120px, .4fr) minmax(180px, .6fr) minmax(220px, .8fr);
  gap: 8px;
}

.wf-plan-actions .btn {
  min-width: 0;
}

.wf-plan-actions .btn-run {
  grid-column: auto;
}

@media (max-width: 980px) {
  .wf-plan {
    left: 18px;
    right: 18px;
    grid-template-columns: 1fr;
    grid-template-rows: auto auto minmax(0, 1fr) minmax(160px, .45fr) auto;
  }

  .wf-plan-output,
  .wf-plan-chat {
    grid-column: 1;
    grid-row: auto;
  }

  .wf-plan-actions {
    grid-template-columns: 1fr;
  }
}

.wf-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.wf-side-actions {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: stretch;
  gap: 8px;
  overflow: hidden;
}

.wf-side-head h3 {
  margin: 2px 0 0;
  color: var(--text);
  font-size: 17px;
  line-height: 1.25;
}

.wf-side-kicker,
.wf-field > span {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.wf-side-status {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 34px;
  padding: 8px 10px;
  border: 1px solid var(--chip-border);
  border-radius: 8px;
  background: var(--wf-subtle-bg);
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.35;
}

.wf-side-content {
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.wf-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wf-side-note {
  min-width: 0;
  grid-column: 1 / -1;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  background: var(--wf-input-bg);
  color: var(--text);
  font-family: inherit;
  font-size: 12px;
  padding: 8px 10px;
}

.wf-side-note:focus {
  border-color: var(--border-bright);
  box-shadow: 0 0 0 2px var(--focus-ring);
}

.wf-side-text {
  min-height: 0;
  flex: 1;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  resize: none;
  background: var(--wf-input-bg);
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.7;
  padding: 12px;
  white-space: pre-wrap;
}

.wf-field .wf-side-text {
  min-height: 180px;
}

.wf-side-text:focus {
  border-color: var(--border-bright);
  box-shadow: 0 0 0 2px var(--focus-ring);
}

.wf-side-callout {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--wf-node-idea) 38%, var(--border));
  border-radius: 10px;
  background:
    radial-gradient(circle at 8% 10%, color-mix(in srgb, var(--wf-node-idea) 18%, transparent), transparent 58%),
    var(--wf-subtle-bg);
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.45;
}

.wf-side-callout b {
  color: var(--text);
  font-size: 13px;
}

.wf-word-slider {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--wf-node-idea) 22%, var(--border));
  border-radius: 10px;
  background: linear-gradient(135deg, color-mix(in srgb, var(--wf-node-idea) 8%, transparent), transparent 68%), var(--wf-subtle-bg);
}

.wf-word-slider-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.wf-word-slider-head span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.wf-word-slider-head b {
  color: var(--text);
  font-size: 13px;
  font-weight: 900;
}

.wf-word-input {
  width: 82px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--wf-button-border);
  border-radius: 7px;
  background: var(--wf-input-solid);
  color: var(--wf-button-text-strong);
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  text-align: right;
}

.wf-word-input:focus {
  outline: none;
  border-color: var(--wf-primary-border);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 14%, transparent);
}

.wf-word-slider input[type="range"] {
  width: 100%;
  margin: 0;
  accent-color: var(--primary);
}

.wf-word-slider-track {
  position: relative;
  display: grid;
}

.wf-word-slider-track::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 4px;
  transform: translateY(-50%);
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary) 14%, var(--wf-button-bg));
  pointer-events: none;
}

.wf-word-slider-track input {
  position: relative;
  z-index: 1;
}

.wf-word-slider-scale {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
}

.wf-word-slider-scale span:nth-child(2) {
  color: color-mix(in srgb, var(--primary) 72%, var(--text-muted));
  font-weight: 800;
}

.wf-style-picker {
  display: grid;
  gap: 10px;
  padding: 11px;
  border: 1px solid color-mix(in srgb, var(--wf-node-idea) 20%, var(--border));
  border-radius: 10px;
  background:
    radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--wf-node-idea) 12%, transparent), transparent 38%),
    var(--wf-subtle-bg);
}

.wf-style-quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.wf-style-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  padding: 11px 12px;
  border: 1px solid color-mix(in srgb, var(--wf-node-idea) 28%, var(--chip-border));
  border-radius: 10px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--wf-node-idea) 10%, transparent), transparent 65%),
    var(--wf-input-bg);
}

.wf-style-hero.chosen {
  border-color: color-mix(in srgb, var(--success-text) 32%, var(--chip-border));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--success-text) 10%, transparent), transparent 65%),
    var(--wf-input-bg);
}

.wf-style-hero-copy {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.wf-style-hero-copy strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 900;
  line-height: 1.25;
}

.wf-style-hero-copy p {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.55;
}

.wf-style-hero-badge {
  align-self: center;
  height: 24px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--wf-node-idea) 30%, var(--chip-border));
  border-radius: 999px;
  background: color-mix(in srgb, var(--wf-node-idea) 10%, transparent);
  color: var(--text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}

.wf-style-hero.chosen .wf-style-hero-badge {
  border-color: color-mix(in srgb, var(--success-text) 34%, var(--chip-border));
  background: color-mix(in srgb, var(--success-text) 12%, transparent);
  color: var(--success-text);
}

.wf-style-chip {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--wf-node-idea) 24%, var(--chip-border));
  border-radius: 999px;
  background: var(--wf-input-bg);
  color: var(--text);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  transition: .16s ease;
}

.wf-style-chip:hover,
.wf-style-chip.active {
  border-color: color-mix(in srgb, var(--wf-node-idea) 42%, var(--border-bright));
  background: color-mix(in srgb, var(--wf-node-idea) 12%, var(--wf-input-bg));
  color: var(--text);
}

.wf-style-picker-head,
.wf-style-actions,
.wf-style-option span {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.wf-style-picker-head span,
.wf-style-group {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.wf-style-select-wrap {
  display: grid;
  gap: 6px;
}

.wf-style-select-label {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.wf-style-current {
  display: grid;
  gap: 4px;
  padding: 9px;
  border: 1px solid var(--border-bright);
  border-radius: 8px;
  background: var(--active-bg);
}

.wf-style-current b,
.wf-style-option b {
  color: var(--text);
  font-size: 13px;
}

.wf-style-current em,
.wf-style-option em,
.wf-style-option small {
  color: var(--text-muted);
  font-size: 11px;
  font-style: normal;
  line-height: 1.5;
}

.wf-style-current p {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.55;
}

.wf-style-list {
  display: grid;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
  padding-right: 2px;
}

.wf-style-group {
  padding-top: 4px;
}

.wf-style-option {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 8px;
  border: 1px solid var(--chip-border);
  border-radius: 8px;
  background: var(--wf-input-bg);
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}

.wf-style-option:hover,
.wf-style-option.active {
  border-color: var(--border-bright);
  background: var(--active-bg);
}

select.wf-side-input,
.wf-style-select {
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  color-scheme: light;
  background-color: var(--wf-input-bg);
  padding-right: 34px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23757584' d='M6 8L2 4h8z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 11px center;
}

select.wf-side-input option,
.wf-style-select option {
  background: var(--wf-input-bg);
  color: var(--text);
}

.wf-side-list {
  display: grid;
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
  padding-right: 2px;
}

.wf-side-idea {
  display: grid;
  grid-template-columns: 24px auto;
  gap: 4px 8px;
  width: 100%;
  padding: 9px;
  border: 1px solid var(--chip-border);
  border-radius: 8px;
  background: var(--wf-subtle-bg);
  color: var(--text);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

.wf-side-idea:hover,
.wf-side-idea.picked {
  border-color: var(--border-bright);
  background: var(--active-bg);
}

.wf-side-idea span {
  grid-row: span 2;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  background: var(--accent-soft);
  color: var(--primary-light);
  font-size: 11px;
  font-weight: 800;
}

.wf-side-idea b {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.wf-side-idea em {
  min-width: 0;
  color: var(--text-dim);
  font-size: 12px;
  font-style: normal;
  line-height: 1.45;
  white-space: normal;
}

.wf-comments {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--chip-border);
  border-radius: 10px;
  background:
    linear-gradient(135deg, rgba(245, 158, 11, 0.08), rgba(255, 255, 255, 0)),
    var(--wf-subtle-bg);
}

.wf-comments-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.wf-comments-head small {
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 700;
}

.wf-comment-card {
  display: grid;
  gap: 7px;
  padding: 10px;
  border: 1px solid var(--border);
  border-left: 3px solid #f59e0b;
  border-radius: 9px;
  background: var(--wf-node-bg);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.06);
}

.wf-comment-card blockquote {
  margin: 0;
  padding: 7px 9px;
  border-radius: 7px;
  background: rgba(245, 158, 11, 0.09);
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.55;
}

.wf-comment-card p {
  margin: 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
}

.wf-comment-remove {
  justify-self: end;
  border: 0;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 800;
}

.wf-comment-remove:hover {
  color: #b45309;
}

.wf-ai-pop {
  position: fixed;
  z-index: 260;
  width: min(360px, calc(100vw - 24px));
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--wf-floating-bg);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(18px) saturate(1.12);
  -webkit-backdrop-filter: blur(18px) saturate(1.12);
}

.wf-ai-pop-head,
.wf-ai-pop-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.wf-ai-pop-head span {
  color: var(--text);
  font-size: 13px;
  font-weight: 800;
}

.wf-ai-pop blockquote {
  margin: 0;
  max-height: 92px;
  overflow-y: auto;
  padding: 8px 9px;
  border-radius: 8px;
  background: var(--wf-subtle-bg);
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.55;
}

.wf-ai-pop-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  resize: vertical;
  background: var(--wf-input-bg);
  color: var(--text);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.55;
  padding: 9px 10px;
}

.wf-ai-pop-input:focus {
  border-color: var(--border-bright);
  box-shadow: 0 0 0 2px var(--focus-ring);
}

.wf-side-actions .btn {
  min-width: 0;
  width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wf-side-actions .btn-feishu {
  width: 100%;
}

.wf-side-actions .btn-run {
  grid-column: 1 / -1;
  width: auto;
  min-width: 0;
}

.wf-output-backdrop {
  position: fixed;
  inset: 0;
  z-index: 240;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.34);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 24px;
}

.wf-output-panel {
  width: min(920px, calc(100vw - 48px));
  height: min(760px, calc(100vh - 48px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--wf-node-bg);
  box-shadow: var(--shadow-lg);
  padding: 16px;
}

.wf-output-panel header,
.wf-output-panel footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.wf-output-panel h3 {
  margin: 2px 0 0;
  color: var(--text);
  font-size: 18px;
}

.wf-output-panel span {
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
}

.wf-output-panel footer {
  justify-content: flex-end;
}

.wf-output-text {
  min-height: 0;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  outline: none;
  resize: none;
  background: var(--wf-input-bg);
  color: var(--text);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.75;
  padding: 14px;
  white-space: pre-wrap;
}

@keyframes wfPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.25); }
}

.wf-hdr,
.wf-side,
.wf-output-panel,
.wf-ai-popover {
  border-color: var(--card-border, var(--border));
  background: var(--wf-floating-solid);
  box-shadow: var(--shadow);
}

.wf-canvas {
  background-color: var(--wf-canvas-bg);
}

.wf-node-body {
  border-color: var(--wf-node-border-readable);
  background:
    var(--wf-node-sheen),
    var(--wf-node-bg-readable);
}

.wf-nhdr {
  border-bottom-color: var(--divider, var(--border));
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--node-accent) 12%, transparent), transparent 70%),
    var(--wf-subtle-solid);
}

.wf-s,
.wf-platform-candidate,
.wf-style-card,
.wf-reference-card,
.wf-source-tabs button,
.wf-side-card {
  border-color: var(--chip-border);
  background: var(--wf-subtle-solid);
}

.wf-platform-candidate:hover,
.wf-style-card:hover,
.wf-reference-card:hover,
.wf-source-tabs button:hover {
  border-color: var(--card-border-hover, var(--border-bright));
  background: color-mix(in srgb, var(--node-accent, var(--primary)) 10%, var(--wf-subtle-solid));
}

.wf-i,
.wf-side-input,
.wf-side-note,
.wf-ai-pop-input,
.wf-output-text {
  border-color: var(--input-border, var(--border));
  background: var(--wf-input-solid);
}

.wf-st {
  background: var(--text-muted);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--text-muted) 18%, transparent);
}

.wf-st.running {
  background: var(--primary);
  box-shadow: 0 0 0 4px var(--focus-ring), 0 0 14px var(--primary-shadow-hover);
}

.wf-st.done {
  background: var(--success-text);
  box-shadow: 0 0 0 4px var(--success-bg);
}

.wf-st.pending {
  background: var(--warning-text);
  box-shadow: 0 0 0 4px var(--warning-bg);
}

.wf-st.error {
  background: var(--danger-text);
  box-shadow: 0 0 0 4px var(--danger-bg);
}
</style>


