const { ItemView, MarkdownView, Notice, Plugin } = require('obsidian');

const VIEW_TYPE_TIMEBOX_PLANNER = 'timebox-planner-view';
const START_MARKER = '<!-- timebox-planner:start -->';
const END_MARKER = '<!-- timebox-planner:end -->';
const DATA_BLOCK_REGEX = /```timebox-data\n([\s\S]*?)\n```/m;
const ITEM_ID_REGEX = /\s*<!--\s*tb:item=([a-zA-Z0-9_-]+)\s*-->\s*$/;
const DATA_COMMENT_REGEX = /<!--\s*timebox-planner:data\s+([\s\S]*?)\s*-->/m;

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createPlannerItem(id, source, text = '') {
  return {
    id,
    source,
    text,
  };
}

function createEmptyPlannerDoc() {
  return {
    version: 1,
    grid: {
      startHour: 7,
      endHour: 23,
      slotMinutes: 30,
    },
    topPriorities: [
      createPlannerItem('tp_1', 'top'),
      createPlannerItem('tp_2', 'top'),
      createPlannerItem('tp_3', 'top'),
    ],
    brainDump: [],
    blocks: [],
  };
}

function getManagedBlock(noteContent) {
  const start = noteContent.indexOf(START_MARKER);
  const end = noteContent.indexOf(END_MARKER);

  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  return noteContent.slice(start, end + END_MARKER.length);
}

function getSection(blockContent, startHeading, endHeading) {
  const start = blockContent.indexOf(startHeading);
  const end = blockContent.indexOf(endHeading);

  if (start === -1 || end === -1 || end <= start) {
    return '';
  }

  return blockContent.slice(start + startHeading.length, end).trim();
}

function parseLegacyItems(sectionContent, source, keepBlank) {
  const items = [];
  const lines = sectionContent.split('\n');

  for (const rawLine of lines) {
    if (!rawLine.startsWith('- ')) {
      continue;
    }

    const idMatch = rawLine.match(ITEM_ID_REGEX);
    const itemId = idMatch ? idMatch[1] : createId(source === 'top' ? 'tp' : 'bd');
    const text = rawLine.replace(/^- /, '').replace(ITEM_ID_REGEX, '').trim();

    if (!keepBlank && !text) {
      continue;
    }

    items.push(createPlannerItem(itemId, source, text));
  }

  return items;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findSectionRange(noteContent, headingText) {
  const headingRegex = new RegExp(`^## ${escapeRegExp(headingText)}\\s*$`, 'm');
  const headingMatch = headingRegex.exec(noteContent);

  if (!headingMatch) {
    return null;
  }

  const headingStart = headingMatch.index;
  const headingLineEnd = noteContent.indexOf('\n', headingStart);
  const contentStart = headingLineEnd === -1 ? noteContent.length : headingLineEnd + 1;
  const rest = noteContent.slice(contentStart);
  const nextHeadingMatch = /^##\s.+$/m.exec(rest);
  const endIndex = nextHeadingMatch ? contentStart + nextHeadingMatch.index : noteContent.length;

  return {
    headingStart,
    contentStart,
    endIndex,
  };
}

function getVisibleSectionContent(noteContent, headingText) {
  const range = findSectionRange(noteContent, headingText);

  if (!range) {
    return null;
  }

  return noteContent.slice(range.contentStart, range.endIndex);
}

function parseVisibleItems(sectionContent, source, keepBlank) {
  const items = [];
  const lines = sectionContent.split('\n');

  for (const rawLine of lines) {
    const match = rawLine.match(/^- (?:\[[ xX]\]\s*)?(.*)$/);

    if (!match) {
      continue;
    }

    let text = match[1].replace(ITEM_ID_REGEX, '').trim();

    if (source === 'top') {
      text = text.replace(/^`?P\d`?\s*/, '').replace(/^P\d[:\s-]*/, '').trim();
    }

    if (!keepBlank && !text) {
      continue;
    }

    items.push(text);
  }

  return items;
}

function parseDataComment(noteContent) {
  const dataMatch = noteContent.match(DATA_COMMENT_REGEX);

  if (!dataMatch) {
    return null;
  }

  try {
    return JSON.parse(dataMatch[1]);
  } catch (_error) {
    return null;
  }
}

function parseLegacyData(legacyBlock) {
  const dataMatch = legacyBlock.match(DATA_BLOCK_REGEX);

  if (!dataMatch) {
    return null;
  }

  try {
    return JSON.parse(dataMatch[1]);
  } catch (_error) {
    return null;
  }
}

function removeLegacyManagedBlock(noteContent) {
  const legacyBlock = getManagedBlock(noteContent);

  if (!legacyBlock) {
    return noteContent;
  }

  return noteContent.replace(legacyBlock, '').replace(/\n{3,}/g, '\n\n').trimStart();
}

function removeDataComment(noteContent) {
  return noteContent.replace(DATA_COMMENT_REGEX, '').replace(/\n{3,}/g, '\n\n').trimEnd();
}

function normalizeTopPriorities(items) {
  const nextItems = items.slice(0, 3);

  while (nextItems.length < 3) {
    nextItems.push(createPlannerItem(`tp_${nextItems.length + 1}`, 'top'));
  }

  return nextItems;
}

function sanitizeGrid(grid) {
  if (!grid || typeof grid !== 'object') {
    return {
      startHour: 7,
      endHour: 23,
      slotMinutes: 30,
    };
  }

  const startHour = Number.isInteger(grid.startHour) ? grid.startHour : 7;
  const endHour = Number.isInteger(grid.endHour) ? grid.endHour : 23;

  return {
    startHour,
    endHour,
    slotMinutes: 30,
  };
}

function sanitizeBlocks(blocks, totalSlots) {
  if (!Array.isArray(blocks)) {
    return [];
  }

  return blocks
    .map((block) => ({
      id: typeof block.id === 'string' ? block.id : createId('blk'),
      itemId: typeof block.itemId === 'string' ? block.itemId : undefined,
      label: typeof block.label === 'string' ? block.label : undefined,
      startSlot: Number.isInteger(block.startSlot) ? block.startSlot : -1,
      endSlot: Number.isInteger(block.endSlot) ? block.endSlot : -1,
    }))
    .filter((block) => {
      return (
        block.startSlot >= 0 &&
        block.endSlot > block.startSlot &&
        block.endSlot <= totalSlots
      );
    })
    .sort((left, right) => left.startSlot - right.startSlot);
}

function parsePlannerDoc(noteContent) {
  const doc = createEmptyPlannerDoc();
  const managedBlock = getManagedBlock(noteContent);
  const contentWithoutLegacyBlock = removeLegacyManagedBlock(noteContent);
  const visibleTopSection = getVisibleSectionContent(contentWithoutLegacyBlock, 'Top Priorities');
  const visibleBrainSection = getVisibleSectionContent(contentWithoutLegacyBlock, 'Brain Dump');
  const visibleTopTexts =
    visibleTopSection !== null ? parseVisibleItems(visibleTopSection, 'top', true) : null;
  const visibleBrainTexts =
    visibleBrainSection !== null ? parseVisibleItems(visibleBrainSection, 'brain', false) : null;
  const legacyTopItems = managedBlock
    ? parseLegacyItems(getSection(managedBlock, '## Top Priorities', '## Brain Dump'), 'top', true)
    : [];
  const legacyBrainItems = managedBlock
    ? parseLegacyItems(getSection(managedBlock, '## Brain Dump', '## Timebox Data'), 'brain', false)
    : [];
  const parsedData = parseDataComment(noteContent) || (managedBlock ? parseLegacyData(managedBlock) : null);
  const brainDumpIds = Array.isArray(parsedData && parsedData.brainDumpIds)
    ? parsedData.brainDumpIds
    : legacyBrainItems.map((item) => item.id);

  if (visibleTopTexts !== null) {
    doc.topPriorities = normalizeTopPriorities(
      visibleTopTexts.map((text, index) => createPlannerItem(`tp_${index + 1}`, 'top', text)),
    );
  } else if (legacyTopItems.length > 0) {
    doc.topPriorities = normalizeTopPriorities(
      legacyTopItems.map((item, index) => createPlannerItem(`tp_${index + 1}`, 'top', item.text)),
    );
  }

  if (visibleBrainTexts !== null) {
    doc.brainDump = visibleBrainTexts.map((text, index) =>
      createPlannerItem(brainDumpIds[index] || createId('bd'), 'brain', text),
    );
  } else if (legacyBrainItems.length > 0) {
    doc.brainDump = legacyBrainItems.map((item) => createPlannerItem(item.id, 'brain', item.text));
  }

  if (parsedData) {
    doc.grid = sanitizeGrid(parsedData.grid);
    doc.blocks = sanitizeBlocks(
      parsedData.blocks,
      (doc.grid.endHour - doc.grid.startHour) * 2,
    );
  }

  return doc;
}

function renderTopPriorityLine(item) {
  if (!item.text) {
    return '- ';
  }

  return `- ${item.text}`;
}

function renderBrainDumpLine(item) {
  return `- ${item.text}`;
}

function serializePlannerData(doc) {
  return `<!-- timebox-planner:data ${JSON.stringify({
    version: doc.version,
    grid: doc.grid,
    brainDumpIds: doc.brainDump.map((item) => item.id),
    blocks: doc.blocks,
  })} -->`;
}

function insertAfterFrontmatter(noteContent, sectionBlock) {
  const frontmatterMatch = noteContent.match(/^---\n[\s\S]*?\n---\n*/);

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[0];
    const rest = noteContent.slice(frontmatter.length).trimStart();

    if (!rest) {
      return `${frontmatter}\n${sectionBlock}\n`;
    }

    return `${frontmatter}\n${sectionBlock}\n\n${rest}`;
  }

  const rest = noteContent.trimStart();

  if (!rest) {
    return `${sectionBlock}\n`;
  }

  return `${sectionBlock}\n\n${rest}`;
}

function replaceSectionItems(sectionContent, renderedLines) {
  const lines = sectionContent.replace(/\r/g, '').split('\n');
  const listLineIndices = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (/^- (?:\[[ xX]\]\s*)?/.test(lines[index])) {
      listLineIndices.push(index);
    }
  }

  const renderedBlock = renderedLines.join('\n');

  if (listLineIndices.length === 0) {
    const trimmedContent = sectionContent.trim();

    if (!trimmedContent && !renderedBlock) {
      return '\n';
    }

    if (!trimmedContent) {
      return `\n${renderedBlock}\n`;
    }

    if (!renderedBlock) {
      return `\n${trimmedContent}\n`;
    }

    return `\n${trimmedContent}\n\n${renderedBlock}\n`;
  }

  const prefix = lines.slice(0, listLineIndices[0]).join('\n').trimEnd();
  const suffix = lines.slice(listLineIndices[listLineIndices.length - 1] + 1).join('\n').trim();
  const parts = [];

  if (prefix) {
    parts.push(prefix);
  }

  if (renderedBlock) {
    parts.push(renderedBlock);
  }

  if (suffix) {
    parts.push(suffix);
  }

  if (parts.length === 0) {
    return '\n';
  }

  return `\n${parts.join('\n\n')}\n`;
}

function findInsertAnchor(noteContent) {
  const footerRuleIndex = noteContent.lastIndexOf('\n---\n');

  if (footerRuleIndex > 0) {
    return footerRuleIndex + 1;
  }

  const dataCommentMatch = noteContent.match(DATA_COMMENT_REGEX);

  if (dataCommentMatch) {
    return dataCommentMatch.index;
  }

  const trailingHeadings = [
    '내일 할 일',
    '메모 / 회고',
    '오늘 할 일 (자동 목록 / Backlog)',
    '오늘 컨텍스트',
  ];

  for (const heading of trailingHeadings) {
    const range = findSectionRange(noteContent, heading);

    if (range) {
      return range.endIndex;
    }
  }

  return noteContent.trimEnd().length;
}

function upsertSection(noteContent, headingText, renderedLines) {
  const sectionRange = findSectionRange(noteContent, headingText);

  if (sectionRange) {
    const currentSectionContent = noteContent.slice(sectionRange.contentStart, sectionRange.endIndex);
    const nextSectionContent = replaceSectionItems(currentSectionContent, renderedLines);

    return `${noteContent.slice(0, sectionRange.contentStart)}${nextSectionContent}${noteContent.slice(sectionRange.endIndex)}`;
  }

  const sectionBlock = `## ${headingText}\n\n${renderedLines.join('\n')}\n`;
  const insertIndex = findInsertAnchor(noteContent);

  if (insertIndex === null) {
    return insertAfterFrontmatter(noteContent, sectionBlock);
  }

  const before = noteContent.slice(0, insertIndex).trimEnd();
  const after = noteContent.slice(insertIndex).trimStart();

  if (!before) {
    return `${sectionBlock}\n${after}`;
  }

  if (!after) {
    return `${before}\n\n${sectionBlock}\n`;
  }

  return `${before}\n\n${sectionBlock}\n${after}`;
}

function replacePlannerBlock(noteContent, doc) {
  let nextContent = removeLegacyManagedBlock(noteContent);
  nextContent = removeDataComment(nextContent);
  nextContent = upsertSection(
    nextContent,
    'Brain Dump',
    doc.brainDump.map((item) => renderBrainDumpLine(item)),
  );
  nextContent = upsertSection(
    nextContent,
    'Top Priorities',
    doc.topPriorities.map((item) => renderTopPriorityLine(item)),
  );

  return `${nextContent.trimEnd()}\n\n${serializePlannerData(doc)}\n`;
}

function formatHourLabel(hour) {
  if (hour === 0 || hour === 12) {
    return '12';
  }

  if (hour > 12) {
    return String(hour - 12);
  }

  return String(hour);
}

function slotToLabel(doc, slotIndex) {
  const totalMinutes = doc.grid.startHour * 60 + slotIndex * 30;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

class TimeboxPlannerView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.file = null;
    this.doc = createEmptyPlannerDoc();
    this.persistTimer = null;
    this.selectedItemId = null;
    this.gridResizeObserver = null;
    this.gridOverlayFrame = null;
    this.gridElement = null;
    this.overlayLayerElement = null;
    this.slotElements = new Map();
    this.pointerInteraction = null;
    this.boundPointerMove = null;
    this.boundPointerUp = null;
  }

  getViewType() {
    return VIEW_TYPE_TIMEBOX_PLANNER;
  }

  getDisplayText() {
    return 'Timebox Planner';
  }

  getIcon() {
    return 'calendar-range';
  }

  async onOpen() {
    await this.reloadFromActiveFile();
  }

  async onClose() {
    await this.flushPendingPersist();
    this.disposeGridOverlayObserver();
    this.teardownPointerListeners();
  }

  getTotalSlots() {
    return (this.doc.grid.endHour - this.doc.grid.startHour) * 2;
  }

  getAllItems() {
    return [...this.doc.topPriorities, ...this.doc.brainDump];
  }

  getSelectedItem() {
    if (!this.selectedItemId) {
      return null;
    }

    return this.findItemById(this.selectedItemId) || null;
  }

  findItemById(itemId) {
    return this.getAllItems().find((item) => item.id === itemId);
  }

  findBlockBySlot(slotIndex) {
    return this.doc.blocks.find(
      (block) => slotIndex >= block.startSlot && slotIndex < block.endSlot,
    );
  }

  getBlockLabel(block) {
    if (block.label) {
      return block.label;
    }

    const linkedItem = this.findItemById(block.itemId);

    if (linkedItem && linkedItem.text) {
      return linkedItem.text;
    }

    return '연결 끊긴 블록';
  }

  getItemTag(item) {
    if (item.source === 'top') {
      const itemIndex = this.doc.topPriorities.findIndex((priority) => priority.id === item.id);

      if (itemIndex !== -1) {
        return `P${itemIndex + 1}`;
      }
    }

    if (item.source === 'brain') {
      return 'BD';
    }

    return null;
  }

  getBlockTag(block) {
    if (!block.itemId) {
      return null;
    }

    const linkedItem = this.findItemById(block.itemId);

    if (!linkedItem) {
      return null;
    }

    return this.getItemTag(linkedItem);
  }

  getBlockKind(block) {
    if (block.label && !block.itemId) {
      return 'manual';
    }

    const linkedItem = this.findItemById(block.itemId);

    if (!linkedItem) {
      return 'orphan';
    }

    return linkedItem.source;
  }

  async reloadFromActiveFile() {
    await this.flushPendingPersist();

    this.file = this.plugin.resolveTargetFile();

    if (!this.file) {
      this.doc = createEmptyPlannerDoc();
      this.render();
      return;
    }

    const noteContent = await this.app.vault.read(this.file);
    this.doc = parsePlannerDoc(noteContent);
    this.render();
  }

  render() {
    const previousScrollTop = this.contentEl.scrollTop;
    this.disposeGridOverlayObserver();

    this.contentEl.empty();
    this.contentEl.addClass('tb-root');

    const headerEl = this.contentEl.createDiv({ cls: 'tb-view-header' });
    const titleWrapEl = headerEl.createDiv({ cls: 'tb-view-title-wrap' });
    titleWrapEl.createEl('h2', { text: 'The Time Box.' });
    titleWrapEl.createDiv({
      cls: 'tb-view-subtitle',
      text: this.file ? this.file.basename : '활성 마크다운 노트를 먼저 열어 주세요.',
    });

    const headerActionsEl = headerEl.createDiv({ cls: 'tb-view-actions' });
    const reloadButton = headerActionsEl.createEl('button', {
      cls: 'tb-button tb-button--ghost',
      text: '새로고침',
    });
    reloadButton.type = 'button';
    reloadButton.addEventListener('click', () => {
      void this.reloadFromActiveFile();
    });

    if (!this.file) {
      const emptyEl = this.contentEl.createDiv({ cls: 'tb-empty-state' });
      emptyEl.createEl('p', {
        text: '데일리 노트를 연 뒤 명령어 `Open Timebox Planner`를 다시 실행하세요.',
      });
      return;
    }

    const helpEl = this.contentEl.createDiv({ cls: 'tb-help' });
    const selectedItem = this.getSelectedItem();

    if (selectedItem && selectedItem.text.trim()) {
      helpEl.addClass('is-active');

      const helpTitle = helpEl.createDiv({ cls: 'tb-help-title' });
      helpTitle.setText(`선택됨: ${selectedItem.text}`);

      const helpBody = helpEl.createDiv({ cls: 'tb-help-body' });
      helpBody.setText('우측 빈 슬롯을 클릭해 시간표에 배치하거나, BD 카드를 Priority 카드 위로 드롭해 복사할 수 있습니다.');

      const helpActions = helpEl.createDiv({ cls: 'tb-help-actions' });
      const clearButton = helpActions.createEl('button', {
        cls: 'tb-button tb-button--ghost',
        text: '선택 해제',
      });
      clearButton.type = 'button';
      clearButton.addEventListener('click', () => {
        this.selectedItemId = null;
        this.render();
      });
    } else {
      helpEl.setText('카드를 클릭해 선택한 뒤 우측 빈 슬롯을 클릭하거나, BD 카드를 Priority 카드 위로 드롭해 복사하세요.');
    }

    const layoutEl = this.contentEl.createDiv({ cls: 'tb-layout' });
    const leftEl = layoutEl.createDiv({ cls: 'tb-left' });
    const rightEl = layoutEl.createDiv({ cls: 'tb-right' });

    this.renderTopPriorities(leftEl);
    this.renderBrainDump(leftEl);
    this.renderTimeGrid(rightEl);

    window.requestAnimationFrame(() => {
      this.contentEl.scrollTop = previousScrollTop;
    });
  }

  renderTopPriorities(parentEl) {
    const sectionEl = parentEl.createDiv({ cls: 'tb-section' });
    sectionEl.createEl('h3', { text: 'Top Priorities' });

    this.doc.topPriorities.forEach((item, index) => {
      this.renderItemCard(sectionEl, item, {
        badge: `P${index + 1}`,
        placeholder: `우선순위 ${index + 1}`,
        acceptsCopyDrop: true,
      });
    });
  }

  renderBrainDump(parentEl) {
    const sectionEl = parentEl.createDiv({ cls: 'tb-section tb-section--brain' });
    sectionEl.createEl('h3', { text: 'Brain Dump' });

    const hintEl = sectionEl.createDiv({ cls: 'tb-section-hint' });
    hintEl.setText('한 줄에 하나의 작업으로 적고, 필요한 항목만 시간표로 드래그하세요.');

    if (this.doc.brainDump.length === 0) {
      const emptyEl = sectionEl.createDiv({ cls: 'tb-empty-items' });
      emptyEl.setText('아직 Brain Dump 항목이 없습니다.');
    } else {
      this.doc.brainDump.forEach((item) => {
        this.renderItemCard(sectionEl, item, {
          badge: 'BD',
          placeholder: 'Brain Dump 항목',
        });
      });
    }

    const addButton = sectionEl.createEl('button', {
      cls: 'tb-button',
      text: '+ Brain Dump 항목 추가',
    });
    addButton.type = 'button';
    addButton.addEventListener('click', async () => {
      this.doc.brainDump.push(createPlannerItem(createId('bd'), 'brain'));
      await this.persist();
      this.render();
    });
  }

  renderItemCard(parentEl, item, options) {
    const cardEl = parentEl.createDiv({ cls: `tb-item-card tb-item-card--${item.source}` });
    cardEl.draggable = true;
    cardEl.title = '클릭해서 선택하거나 카드 자체를 시간표로 끌어 놓기';
    if (this.selectedItemId === item.id) {
      cardEl.addClass('is-selected');
    }
    const headerEl = cardEl.createDiv({ cls: 'tb-item-card-header' });
    const leftMetaEl = headerEl.createDiv({ cls: 'tb-item-card-meta' });
    const actionsEl = headerEl.createDiv({ cls: 'tb-item-card-actions' });

    const badgeEl = leftMetaEl.createDiv({ cls: 'tb-item-badge' });
    badgeEl.setText(options.badge);

    cardEl.addEventListener('click', (event) => {
      const targetEl = event.target instanceof HTMLElement ? event.target : null;

      if (targetEl && (targetEl.tagName === 'TEXTAREA' || targetEl.closest('button'))) {
        return;
      }

      if (!item.text.trim()) {
        new Notice('먼저 텍스트를 입력하세요.');
        return;
      }

      this.selectedItemId = this.selectedItemId === item.id ? null : item.id;
      this.render();
    });

    cardEl.addEventListener('dragstart', (event) => {
      const targetEl = event.target instanceof HTMLElement ? event.target : null;

      if (targetEl && (targetEl.tagName === 'TEXTAREA' || targetEl.closest('button'))) {
        event.preventDefault();
        return;
      }

      if (!item.text.trim()) {
        event.preventDefault();
        new Notice('먼저 텍스트를 입력한 뒤 드래그하세요.');
        return;
      }

      if (!event.dataTransfer) {
        return;
      }

      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('text/timebox-item-id', item.id);
    });

    const removeButton = actionsEl.createEl('button', {
      cls: 'tb-remove-button',
      text: '삭제',
    });
    removeButton.type = 'button';
    removeButton.addEventListener('click', async () => {
      await this.deletePlannerItem(item);
    });

    if (options.acceptsCopyDrop) {
      cardEl.addEventListener('dragover', (event) => {
        event.preventDefault();
        cardEl.addClass('is-drop-target');
      });

      cardEl.addEventListener('dragleave', (event) => {
        if (!cardEl.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null)) {
          cardEl.removeClass('is-drop-target');
        }
      });

      cardEl.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        cardEl.removeClass('is-drop-target');

        if (!event.dataTransfer) {
          return;
        }

        const sourceItemId = event.dataTransfer.getData('text/timebox-item-id');

        if (!sourceItemId) {
          return;
        }

        void this.copyItemToPriority(sourceItemId, item.id);
      });
    }

    const textareaEl = cardEl.createEl('textarea', { cls: 'tb-item-text' });
    textareaEl.placeholder = options.placeholder;
    textareaEl.value = item.text;
    textareaEl.rows = item.source === 'top' ? 3 : 2;
    textareaEl.draggable = false;
    this.autoResizeTextarea(textareaEl);

    textareaEl.addEventListener('input', () => {
      item.text = textareaEl.value.trim();
      if (!item.text && this.selectedItemId === item.id) {
        this.selectedItemId = null;
      }
      this.autoResizeTextarea(textareaEl);
      this.schedulePersist();
    });

    textareaEl.addEventListener('blur', () => {
      void this.flushPendingPersist();
    });
  }

  async deletePlannerItem(item) {
    this.doc.blocks = this.doc.blocks.filter((block) => block.itemId !== item.id);

    if (item.source === 'brain') {
      this.doc.brainDump = this.doc.brainDump.filter((brainItem) => brainItem.id !== item.id);
    } else {
      item.text = '';
    }

    if (this.selectedItemId === item.id) {
      this.selectedItemId = null;
    }

    await this.persist();
    this.render();
  }

  async copyItemToPriority(sourceItemId, targetPriorityId) {
    const sourceItem = this.findItemById(sourceItemId);
    const targetPriority = this.doc.topPriorities.find((item) => item.id === targetPriorityId);

    if (!sourceItem || !targetPriority) {
      return;
    }

    const nextText = sourceItem.text.trim();

    if (!nextText) {
      new Notice('비어 있지 않은 항목만 복사할 수 있습니다.');
      return;
    }

    targetPriority.text = nextText;
    this.selectedItemId = targetPriority.id;
    await this.persist();
    this.render();
  }

  renderTimeGrid(parentEl) {
    const sectionEl = parentEl.createDiv({ cls: 'tb-section tb-section--grid' });
    const gridHeaderEl = sectionEl.createDiv({ cls: 'tb-grid-title-row' });
    gridHeaderEl.createEl('h3', { text: 'Time Boxes' });

    const gridMetaEl = gridHeaderEl.createDiv({ cls: 'tb-grid-meta' });
    gridMetaEl.setText(`${formatHourLabel(this.doc.grid.startHour)} ~ ${formatHourLabel(this.doc.grid.endHour)}`);

    const gridEl = sectionEl.createDiv({ cls: 'tb-grid' });
    const slotElements = new Map();
    this.gridElement = gridEl;
    this.slotElements = slotElements;
    const headerRowEl = gridEl.createDiv({ cls: 'tb-grid-row tb-grid-row--header' });
    headerRowEl.createDiv({ cls: 'tb-hour tb-hour--header' });
    headerRowEl.createDiv({ cls: 'tb-slot-header', text: ':00' });
    headerRowEl.createDiv({ cls: 'tb-slot-header', text: ':30' });

    for (let hour = this.doc.grid.startHour; hour < this.doc.grid.endHour; hour += 1) {
      const rowEl = gridEl.createDiv({ cls: 'tb-grid-row' });
      rowEl.createDiv({ cls: 'tb-hour', text: formatHourLabel(hour) });
      const leftSlotIndex = (hour - this.doc.grid.startHour) * 2;
      const rightSlotIndex = leftSlotIndex + 1;
      slotElements.set(leftSlotIndex, this.renderSlotCell(rowEl, leftSlotIndex));
      slotElements.set(rightSlotIndex, this.renderSlotCell(rowEl, rightSlotIndex));
    }

    const overlayLayerEl = gridEl.createDiv({ cls: 'tb-block-layer' });
    this.overlayLayerElement = overlayLayerEl;
    this.attachBlockOverlayLayer(gridEl, overlayLayerEl, slotElements);
  }

  renderSlotCell(parentEl, slotIndex) {
    const slotEl = parentEl.createDiv({ cls: 'tb-slot' });
    const block = this.findBlockBySlot(slotIndex);
    slotEl.setAttr('data-slot-index', String(slotIndex));
    slotEl.setAttr('aria-label', slotToLabel(this.doc, slotIndex));
    slotEl.title = slotToLabel(this.doc, slotIndex);

    if (block) {
      const kind = this.getBlockKind(block);
      slotEl.addClass('is-filled');
      slotEl.addClass(`is-${kind}`);

      if (slotIndex === block.startSlot) {
        slotEl.addClass('is-start');
      }

      if (slotIndex === block.endSlot - 1) {
        slotEl.addClass('is-end');
      }

      if (slotIndex > block.startSlot) {
        slotEl.addClass('is-continuation');
      }
      return slotEl;
    }

    if (this.selectedItemId) {
      slotEl.addClass('is-place-target');
      slotEl.title = `${slotToLabel(this.doc, slotIndex)} · 클릭해서 배치`;
    }

    slotEl.addEventListener('dragover', (event) => {
      event.preventDefault();
      slotEl.addClass('is-drop-target');
    });

    slotEl.addEventListener('dragleave', () => {
      slotEl.removeClass('is-drop-target');
    });

    slotEl.addEventListener('drop', (event) => {
      event.preventDefault();
      slotEl.removeClass('is-drop-target');

      if (!event.dataTransfer) {
        return;
      }

      const itemId = event.dataTransfer.getData('text/timebox-item-id');

      if (!itemId) {
        return;
      }

      void this.createBlockFromItem(itemId, slotIndex);
    });

    slotEl.addEventListener('click', () => {
      if (!this.selectedItemId) {
        return;
      }

      void this.createBlockFromItem(this.selectedItemId, slotIndex, {
        clearSelectionAfterPlace: true,
        moveExistingLinkedBlock: true,
      });
    });

    slotEl.addEventListener('dblclick', () => {
      void this.createManualBlock(slotIndex);
    });

    return slotEl;
  }

  attachBlockOverlayLayer(gridEl, overlayLayerEl, slotElements) {
    const renderOverlays = () => {
      if (this.gridOverlayFrame) {
        window.cancelAnimationFrame(this.gridOverlayFrame);
      }

      this.gridOverlayFrame = window.requestAnimationFrame(() => {
        this.gridOverlayFrame = null;
        this.renderBlockOverlays(gridEl, overlayLayerEl, slotElements);
      });
    };

    renderOverlays();

    if (typeof ResizeObserver !== 'undefined') {
      this.gridResizeObserver = new ResizeObserver(() => {
        renderOverlays();
      });
      this.gridResizeObserver.observe(gridEl);
    }
  }

  disposeGridOverlayObserver() {
    if (this.gridResizeObserver) {
      this.gridResizeObserver.disconnect();
      this.gridResizeObserver = null;
    }

    if (this.gridOverlayFrame) {
      window.cancelAnimationFrame(this.gridOverlayFrame);
      this.gridOverlayFrame = null;
    }

    this.gridElement = null;
    this.overlayLayerElement = null;
    this.slotElements = new Map();
  }

  renderBlockOverlays(gridEl, overlayLayerEl, slotElements) {
    overlayLayerEl.empty();

    const gridRect = gridEl.getBoundingClientRect();

    if (!gridRect.width || !gridRect.height) {
      return;
    }

    this.doc.blocks.forEach((block) => {
      const geometry = this.getBlockGeometry(gridRect, slotElements, block);

      if (!geometry) {
        return;
      }

      const kind = this.getBlockKind(block);
      const label = this.getBlockLabel(block);
      const tag = this.getBlockTag(block);
      const overlayEl = overlayLayerEl.createDiv({
        cls: `tb-block-overlay is-${kind}`,
      });
      overlayEl.setAttr('data-block-id', block.id);
      const shapeEl = overlayEl.createDiv({ cls: 'tb-block-shape' });
      this.renderBlockShape(shapeEl, geometry);

      const topResizeHandle = overlayEl.createDiv({
        cls: 'tb-block-resize-handle tb-block-resize-handle--top',
      });
      topResizeHandle.addEventListener('pointerdown', (event) => {
        this.startPointerInteraction('resize-start', block.id, overlayEl, event);
      });

      const bottomResizeHandle = overlayEl.createDiv({
        cls: 'tb-block-resize-handle tb-block-resize-handle--bottom',
      });
      bottomResizeHandle.addEventListener('pointerdown', (event) => {
        this.startPointerInteraction('resize-end', block.id, overlayEl, event);
      });

      const contentEl = overlayEl.createDiv({ cls: 'tb-block-overlay-content' });
      const titleEl = contentEl.createDiv({ cls: 'tb-block-overlay-title' });

      if (tag) {
        const tagEl = titleEl.createSpan({ cls: 'tb-block-overlay-tag' });
        tagEl.setText(tag);
      }

      const labelEl = titleEl.createSpan({ cls: 'tb-block-overlay-label' });
      labelEl.setText(label);
      contentEl.addEventListener('pointerdown', (event) => {
        this.startPointerInteraction('move', block.id, overlayEl, event);
      });
      this.applyBlockOverlayLayout(overlayEl, contentEl, label, geometry, Boolean(tag));

      const controlsEl = overlayEl.createDiv({ cls: 'tb-block-overlay-controls' });
      const extendButton = controlsEl.createEl('button', {
        cls: 'tb-slot-control',
        text: '+30',
      });
      extendButton.type = 'button';
      extendButton.addEventListener('click', (event) => {
        event.stopPropagation();
        void this.extendBlock(block.id);
      });

      const shrinkButton = controlsEl.createEl('button', {
        cls: 'tb-slot-control',
        text: '-30',
      });
      shrinkButton.type = 'button';
      shrinkButton.addEventListener('click', (event) => {
        event.stopPropagation();
        void this.shrinkBlock(block.id);
      });

      if (kind === 'manual' || kind === 'orphan') {
        const editButton = controlsEl.createEl('button', {
          cls: 'tb-slot-control',
          text: '수정',
        });
        editButton.type = 'button';
        editButton.addEventListener('click', (event) => {
          event.stopPropagation();
          void this.editManualBlock(block.id);
        });
      }

      const deleteButton = controlsEl.createEl('button', {
        cls: 'tb-slot-control tb-slot-control--danger',
        text: '삭제',
      });
      deleteButton.type = 'button';
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        void this.deleteBlock(block.id);
      });

      overlayEl.addEventListener('dblclick', () => {
        if (kind === 'manual' || kind === 'orphan') {
          void this.editManualBlock(block.id);
        }
      });
    });
  }

  getBlockGeometry(gridRect, slotElements, block) {
    const occupiedSlots = [];

    for (let slotIndex = block.startSlot; slotIndex < block.endSlot; slotIndex += 1) {
      const slotEl = slotElements.get(slotIndex);

      if (!slotEl) {
        continue;
      }

      const rect = slotEl.getBoundingClientRect();
      occupiedSlots.push({
        slotIndex,
        row: Math.floor(slotIndex / 2),
        col: slotIndex % 2,
        left: rect.left - gridRect.left,
        top: rect.top - gridRect.top,
        right: rect.right - gridRect.left,
        bottom: rect.bottom - gridRect.top,
      });
    }

    if (occupiedSlots.length === 0) {
      return null;
    }

    const left = Math.min(...occupiedSlots.map((slot) => slot.left));
    const right = Math.max(...occupiedSlots.map((slot) => slot.right));
    const top = Math.min(...occupiedSlots.map((slot) => slot.top));
    const bottom = Math.max(...occupiedSlots.map((slot) => slot.bottom));
    const bounds = {
      left,
      top,
      width: right - left,
      height: bottom - top,
    };
    const contentBounds = this.getBlockContentBounds(occupiedSlots, bounds);
    const shapeCells = this.getBlockShapeCells(occupiedSlots, bounds);

    return {
      bounds,
      contentBounds,
      shapeCells,
    };
  }

  getBlockShapeCells(occupiedSlots, bounds) {
    const cellsByKey = new Map();

    occupiedSlots.forEach((slot) => {
      cellsByKey.set(`${slot.row}:${slot.col}`, slot);
    });

    return occupiedSlots.map((slot) => ({
      left: slot.left - bounds.left,
      top: slot.top - bounds.top,
      width: slot.right - slot.left,
      height: slot.bottom - slot.top,
      borderTop: !cellsByKey.has(`${slot.row - 1}:${slot.col}`),
      borderRight: !cellsByKey.has(`${slot.row}:${slot.col + 1}`),
      borderBottom: !cellsByKey.has(`${slot.row + 1}:${slot.col}`),
      borderLeft: !cellsByKey.has(`${slot.row}:${slot.col - 1}`),
      radiusTopLeft: !cellsByKey.has(`${slot.row - 1}:${slot.col}`) && !cellsByKey.has(`${slot.row}:${slot.col - 1}`),
      radiusTopRight: !cellsByKey.has(`${slot.row - 1}:${slot.col}`) && !cellsByKey.has(`${slot.row}:${slot.col + 1}`),
      radiusBottomRight:
        !cellsByKey.has(`${slot.row + 1}:${slot.col}`) && !cellsByKey.has(`${slot.row}:${slot.col + 1}`),
      radiusBottomLeft:
        !cellsByKey.has(`${slot.row + 1}:${slot.col}`) && !cellsByKey.has(`${slot.row}:${slot.col - 1}`),
    }));
  }

  getBlockContentBounds(occupiedSlots, bounds) {
    if (occupiedSlots.length === 1) {
      return {
        left: 0,
        top: 0,
        width: bounds.width,
        height: bounds.height,
      };
    }

    const cellsByKey = new Map();
    let minRow = Number.POSITIVE_INFINITY;
    let maxRow = Number.NEGATIVE_INFINITY;
    let centroidX = 0;
    let centroidY = 0;

    occupiedSlots.forEach((slot) => {
      cellsByKey.set(`${slot.row}:${slot.col}`, slot);
      minRow = Math.min(minRow, slot.row);
      maxRow = Math.max(maxRow, slot.row);
      centroidX += (slot.left + slot.right) / 2;
      centroidY += (slot.top + slot.bottom) / 2;
    });

    centroidX /= occupiedSlots.length;
    centroidY /= occupiedSlots.length;

    let bestCandidate = null;

    for (let topRow = minRow; topRow <= maxRow; topRow += 1) {
      for (let bottomRow = topRow; bottomRow <= maxRow; bottomRow += 1) {
        for (let leftCol = 0; leftCol <= 1; leftCol += 1) {
          for (let rightCol = leftCol; rightCol <= 1; rightCol += 1) {
            const candidateCells = [];
            let isFilled = true;

            for (let row = topRow; row <= bottomRow && isFilled; row += 1) {
              for (let col = leftCol; col <= rightCol; col += 1) {
                const cell = cellsByKey.get(`${row}:${col}`);

                if (!cell) {
                  isFilled = false;
                  break;
                }

                candidateCells.push(cell);
              }
            }

            if (!isFilled || candidateCells.length === 0) {
              continue;
            }

            const candidateLeft = Math.min(...candidateCells.map((cell) => cell.left));
            const candidateRight = Math.max(...candidateCells.map((cell) => cell.right));
            const candidateTop = Math.min(...candidateCells.map((cell) => cell.top));
            const candidateBottom = Math.max(...candidateCells.map((cell) => cell.bottom));
            const candidate = {
              area: (bottomRow - topRow + 1) * (rightCol - leftCol + 1),
              widthCells: rightCol - leftCol + 1,
              heightCells: bottomRow - topRow + 1,
              distance:
                Math.abs((candidateLeft + candidateRight) / 2 - centroidX) +
                Math.abs((candidateTop + candidateBottom) / 2 - centroidY),
              left: candidateLeft - bounds.left,
              top: candidateTop - bounds.top,
              width: candidateRight - candidateLeft,
              height: candidateBottom - candidateTop,
            };

            if (this.isBetterBlockContentCandidate(candidate, bestCandidate)) {
              bestCandidate = candidate;
            }
          }
        }
      }
    }

    if (!bestCandidate) {
      return {
        left: 0,
        top: 0,
        width: bounds.width,
        height: bounds.height,
      };
    }

    return {
      left: bestCandidate.left,
      top: bestCandidate.top,
      width: bestCandidate.width,
      height: bestCandidate.height,
    };
  }

  isBetterBlockContentCandidate(candidate, current) {
    if (!current) {
      return true;
    }

    if (candidate.area !== current.area) {
      return candidate.area > current.area;
    }

    if (candidate.widthCells !== current.widthCells) {
      return candidate.widthCells > current.widthCells;
    }

    if (candidate.distance !== current.distance) {
      return candidate.distance < current.distance;
    }

    if (candidate.heightCells !== current.heightCells) {
      return candidate.heightCells > current.heightCells;
    }

    return candidate.top < current.top;
  }

  applyBlockOverlayLayout(overlayEl, contentEl, label, geometry, hasTag = false) {
    const { bounds, contentBounds } = geometry;
    overlayEl.style.left = `${bounds.left}px`;
    overlayEl.style.top = `${bounds.top}px`;
    overlayEl.style.width = `${bounds.width}px`;
    overlayEl.style.height = `${bounds.height}px`;
    contentEl.style.left = `${contentBounds.left}px`;
    contentEl.style.top = `${contentBounds.top}px`;
    contentEl.style.width = `${contentBounds.width}px`;
    contentEl.style.height = `${contentBounds.height}px`;
    overlayEl.style.setProperty(
      '--tb-block-font-size',
      `${this.computeBlockFontSize(label, contentBounds.width, contentBounds.height, hasTag)}px`,
    );
  }

  renderBlockShape(shapeEl, geometry) {
    shapeEl.empty();

    geometry.shapeCells.forEach((cell) => {
      const segmentEl = shapeEl.createDiv({ cls: 'tb-block-shape-segment' });
      segmentEl.style.left = `${cell.left}px`;
      segmentEl.style.top = `${cell.top}px`;
      segmentEl.style.width = `${cell.width}px`;
      segmentEl.style.height = `${cell.height}px`;
      segmentEl.style.borderTopWidth = cell.borderTop ? '2px' : '0';
      segmentEl.style.borderRightWidth = cell.borderRight ? '2px' : '0';
      segmentEl.style.borderBottomWidth = cell.borderBottom ? '2px' : '0';
      segmentEl.style.borderLeftWidth = cell.borderLeft ? '2px' : '0';
      segmentEl.style.borderTopLeftRadius = cell.radiusTopLeft ? '16px' : '0';
      segmentEl.style.borderTopRightRadius = cell.radiusTopRight ? '16px' : '0';
      segmentEl.style.borderBottomRightRadius = cell.radiusBottomRight ? '16px' : '0';
      segmentEl.style.borderBottomLeftRadius = cell.radiusBottomLeft ? '16px' : '0';
    });
  }

  computeBlockFontSize(label, width, height, hasTag) {
    const safeLength = Math.max(4, label.trim().length);
    const widthBased = width / Math.max(9, Math.min(22, safeLength * 0.58));
    const usableHeight = Math.max(32, hasTag ? height - 28 : height);
    const heightBased = usableHeight / 3.2;
    const computed = Math.min(widthBased, heightBased);

    return Math.max(14, Math.min(34, Math.round(computed)));
  }

  getBlockById(blockId) {
    return this.doc.blocks.find((block) => block.id === blockId) || null;
  }

  startPointerInteraction(mode, blockId, overlayEl, event) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const targetBlock = this.getBlockById(blockId);

    if (!targetBlock) {
      return;
    }

    const pointerSlot = this.getNearestSlotIndexFromPoint(event.clientX, event.clientY);

    if (pointerSlot === null) {
      return;
    }

    this.pointerInteraction = {
      mode,
      blockId,
      overlayEl,
      label: this.getBlockLabel(targetBlock),
      hasTag: Boolean(this.getBlockTag(targetBlock)),
      initialPointerSlot: pointerSlot,
      initialStartSlot: targetBlock.startSlot,
      initialEndSlot: targetBlock.endSlot,
      proposedStartSlot: targetBlock.startSlot,
      proposedEndSlot: targetBlock.endSlot,
    };

    overlayEl.addClass('is-dragging');
    this.setupPointerListeners();
  }

  setupPointerListeners() {
    if (!this.boundPointerMove) {
      this.boundPointerMove = (event) => {
        this.handlePointerMove(event);
      };
    }

    if (!this.boundPointerUp) {
      this.boundPointerUp = (event) => {
        void this.handlePointerUp(event);
      };
    }

    window.addEventListener('pointermove', this.boundPointerMove);
    window.addEventListener('pointerup', this.boundPointerUp);
    window.addEventListener('pointercancel', this.boundPointerUp);
  }

  teardownPointerListeners() {
    if (this.boundPointerMove) {
      window.removeEventListener('pointermove', this.boundPointerMove);
    }

    if (this.boundPointerUp) {
      window.removeEventListener('pointerup', this.boundPointerUp);
      window.removeEventListener('pointercancel', this.boundPointerUp);
    }
  }

  handlePointerMove(event) {
    const interaction = this.pointerInteraction;

    if (!interaction || !this.gridElement) {
      return;
    }

    event.preventDefault();
    this.autoScrollDuringPointerDrag(event.clientY);

    const pointerSlot = this.getNearestSlotIndexFromPoint(event.clientX, event.clientY);

    if (pointerSlot === null) {
      return;
    }

    const candidate = this.getCandidateBlockForInteraction(interaction, pointerSlot);

    if (!candidate) {
      return;
    }

    if (this.hasCollision(candidate, interaction.blockId)) {
      interaction.overlayEl.addClass('is-invalid');
      return;
    }

    interaction.overlayEl.removeClass('is-invalid');
    interaction.proposedStartSlot = candidate.startSlot;
    interaction.proposedEndSlot = candidate.endSlot;

    const geometry = this.getBlockGeometry(
      this.gridElement.getBoundingClientRect(),
      this.slotElements,
      candidate,
    );

    if (!geometry) {
      return;
    }

    const contentEl = interaction.overlayEl.querySelector('.tb-block-overlay-content');
    const shapeEl = interaction.overlayEl.querySelector('.tb-block-shape');

    if (!contentEl || !shapeEl) {
      return;
    }

    this.renderBlockShape(shapeEl, geometry);
    this.applyBlockOverlayLayout(
      interaction.overlayEl,
      contentEl,
      interaction.label,
      geometry,
      interaction.hasTag,
    );
  }

  async handlePointerUp(_event) {
    const interaction = this.pointerInteraction;

    if (!interaction) {
      return;
    }

    this.pointerInteraction = null;
    this.teardownPointerListeners();
    interaction.overlayEl.removeClass('is-dragging');
    interaction.overlayEl.removeClass('is-invalid');

    if (
      interaction.proposedStartSlot === interaction.initialStartSlot &&
      interaction.proposedEndSlot === interaction.initialEndSlot
    ) {
      return;
    }

    const targetBlock = this.getBlockById(interaction.blockId);

    if (!targetBlock) {
      return;
    }

    targetBlock.startSlot = interaction.proposedStartSlot;
    targetBlock.endSlot = interaction.proposedEndSlot;
    this.doc.blocks.sort((left, right) => left.startSlot - right.startSlot);
    await this.persist();
    this.render();
  }

  getCandidateBlockForInteraction(interaction, pointerSlot) {
    const totalSlots = this.getTotalSlots();
    const delta = pointerSlot - interaction.initialPointerSlot;
    let startSlot = interaction.initialStartSlot;
    let endSlot = interaction.initialEndSlot;

    if (interaction.mode === 'move') {
      startSlot = interaction.initialStartSlot + delta;
      endSlot = interaction.initialEndSlot + delta;

      if (startSlot < 0) {
        endSlot += -startSlot;
        startSlot = 0;
      }

      if (endSlot > totalSlots) {
        const overflow = endSlot - totalSlots;
        startSlot -= overflow;
        endSlot = totalSlots;
      }
    }

    if (interaction.mode === 'resize-start') {
      startSlot = Math.max(0, Math.min(interaction.initialStartSlot + delta, interaction.initialEndSlot - 1));
      endSlot = interaction.initialEndSlot;
    }

    if (interaction.mode === 'resize-end') {
      startSlot = interaction.initialStartSlot;
      endSlot = Math.min(totalSlots, Math.max(interaction.initialEndSlot + delta, interaction.initialStartSlot + 1));
    }

    return {
      id: interaction.blockId,
      startSlot,
      endSlot,
    };
  }

  getNearestSlotIndexFromPoint(clientX, clientY) {
    let nearestSlotIndex = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const [slotIndex, slotEl] of this.slotElements.entries()) {
      const rect = slotEl.getBoundingClientRect();

      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return slotIndex;
      }

      const dx =
        clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
      const dy =
        clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      const distance = dx * dx + dy * dy;

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestSlotIndex = slotIndex;
      }
    }

    return nearestSlotIndex;
  }

  autoScrollDuringPointerDrag(clientY) {
    const scrollContainer = this.contentEl;
    const rect = scrollContainer.getBoundingClientRect();
    const threshold = 64;
    const maxStep = 28;
    let scrollDelta = 0;

    if (clientY < rect.top + threshold) {
      const ratio = (rect.top + threshold - clientY) / threshold;
      scrollDelta = -Math.max(8, Math.round(maxStep * ratio));
    } else if (clientY > rect.bottom - threshold) {
      const ratio = (clientY - (rect.bottom - threshold)) / threshold;
      scrollDelta = Math.max(8, Math.round(maxStep * ratio));
    }

    if (!scrollDelta) {
      return;
    }

    const nextScrollTop = scrollContainer.scrollTop + scrollDelta;

    if (nextScrollTop !== scrollContainer.scrollTop) {
      scrollContainer.scrollTop = nextScrollTop;
    }
  }

  schedulePersist() {
    if (this.persistTimer) {
      window.clearTimeout(this.persistTimer);
    }

    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, 250);
  }

  async flushPendingPersist() {
    if (!this.persistTimer) {
      return;
    }

    window.clearTimeout(this.persistTimer);
    this.persistTimer = null;
    await this.persist();
  }

  async persist() {
    if (!this.file) {
      return;
    }

    const currentContent = await this.app.vault.read(this.file);
    const nextContent = replacePlannerBlock(currentContent, this.doc);
    await this.app.vault.modify(this.file, nextContent);
  }

  hasCollision(candidateBlock, ignoreBlockId) {
    return this.doc.blocks.some((block) => {
      if (ignoreBlockId && block.id === ignoreBlockId) {
        return false;
      }

      return candidateBlock.startSlot < block.endSlot && candidateBlock.endSlot > block.startSlot;
    });
  }

  async createBlockFromItem(itemId, slotIndex, options = {}) {
    const linkedItem = this.findItemById(itemId);

    if (!linkedItem || !linkedItem.text.trim()) {
      new Notice('비어 있지 않은 항목만 시간표에 넣을 수 있습니다.');
      return;
    }

    const existingLinkedBlock = options.moveExistingLinkedBlock
      ? this.doc.blocks.find((block) => block.itemId === itemId) || null
      : null;

    if (existingLinkedBlock) {
      const duration = existingLinkedBlock.endSlot - existingLinkedBlock.startSlot;
      const boundedStartSlot = Math.min(slotIndex, this.getTotalSlots() - duration);
      const candidateBlock = {
        ...existingLinkedBlock,
        startSlot: boundedStartSlot,
        endSlot: boundedStartSlot + duration,
      };

      if (this.hasCollision(candidateBlock, existingLinkedBlock.id)) {
        new Notice('이미 사용 중인 시간입니다.');
        return;
      }

      existingLinkedBlock.startSlot = candidateBlock.startSlot;
      existingLinkedBlock.endSlot = candidateBlock.endSlot;
      this.doc.blocks.sort((left, right) => left.startSlot - right.startSlot);

      if (options.clearSelectionAfterPlace) {
        this.selectedItemId = null;
      }

      await this.persist();
      this.render();
      return;
    }

    const nextBlock = {
      id: createId('blk'),
      itemId,
      startSlot: slotIndex,
      endSlot: slotIndex + 1,
    };

    if (this.hasCollision(nextBlock)) {
      new Notice('이미 사용 중인 시간입니다.');
      return;
    }

    this.doc.blocks.push(nextBlock);
    this.doc.blocks.sort((left, right) => left.startSlot - right.startSlot);

    if (options.clearSelectionAfterPlace) {
      this.selectedItemId = null;
    }

    await this.persist();
    this.render();
  }

  async createManualBlock(slotIndex) {
    const label = window.prompt('블록 이름을 입력하세요.', '');

    if (label === null) {
      return;
    }

    const trimmedLabel = label.trim();

    if (!trimmedLabel) {
      return;
    }

    const nextBlock = {
      id: createId('blk'),
      label: trimmedLabel,
      startSlot: slotIndex,
      endSlot: slotIndex + 1,
    };

    if (this.hasCollision(nextBlock)) {
      new Notice('이미 사용 중인 시간입니다.');
      return;
    }

    this.doc.blocks.push(nextBlock);
    this.doc.blocks.sort((left, right) => left.startSlot - right.startSlot);
    await this.persist();
    this.render();
  }

  async extendBlock(blockId) {
    const targetBlock = this.doc.blocks.find((block) => block.id === blockId);

    if (!targetBlock) {
      return;
    }

    if (targetBlock.endSlot >= this.getTotalSlots()) {
      new Notice('더 이상 아래로 늘릴 수 없습니다.');
      return;
    }

    const nextShape = {
      ...targetBlock,
      endSlot: targetBlock.endSlot + 1,
    };

    if (this.hasCollision(nextShape, targetBlock.id)) {
      new Notice('다음 슬롯이 이미 사용 중입니다.');
      return;
    }

    targetBlock.endSlot += 1;
    await this.persist();
    this.render();
  }

  async shrinkBlock(blockId) {
    const targetBlock = this.doc.blocks.find((block) => block.id === blockId);

    if (!targetBlock) {
      return;
    }

    const duration = targetBlock.endSlot - targetBlock.startSlot;

    if (duration <= 1) {
      await this.deleteBlock(blockId);
      return;
    }

    targetBlock.endSlot -= 1;
    await this.persist();
    this.render();
  }

  async editManualBlock(blockId) {
    const targetBlock = this.doc.blocks.find((block) => block.id === blockId);

    if (!targetBlock) {
      return;
    }

    const nextLabel = window.prompt('블록 이름을 수정하세요.', this.getBlockLabel(targetBlock));

    if (nextLabel === null) {
      return;
    }

    const trimmedLabel = nextLabel.trim();

    if (!trimmedLabel) {
      await this.deleteBlock(blockId);
      return;
    }

    targetBlock.label = trimmedLabel;
    targetBlock.itemId = undefined;
    await this.persist();
    this.render();
  }

  async deleteBlock(blockId) {
    this.doc.blocks = this.doc.blocks.filter((block) => block.id !== blockId);
    await this.persist();
    this.render();
  }

  autoResizeTextarea(textareaEl) {
    textareaEl.style.height = 'auto';
    textareaEl.style.height = `${textareaEl.scrollHeight}px`;
  }
}

class TimeboxPlannerPlugin extends Plugin {
  async onload() {
    this.lastMarkdownFile = null;
    this.captureLastMarkdownFile();

    this.registerView(
      VIEW_TYPE_TIMEBOX_PLANNER,
      (leaf) => new TimeboxPlannerView(leaf, this),
    );

    this.addRibbonIcon('calendar-range', 'Open Timebox Planner', () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open-timebox-planner',
      name: 'Open Timebox Planner',
      checkCallback: (checking) => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

        if (!activeView) {
          return false;
        }

        if (!checking) {
          void this.activateView();
        }

        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file) {
          this.lastMarkdownFile = file;
        }
        void this.refreshOpenViews();
      }),
    );

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf && leaf.view instanceof MarkdownView && leaf.view.file) {
          this.lastMarkdownFile = leaf.view.file;
          void this.refreshOpenViews();
        }
      }),
    );
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TIMEBOX_PLANNER);
  }

  async activateView() {
    this.captureLastMarkdownFile();

    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TIMEBOX_PLANNER);

    const leaf =
      this.app.workspace.getLeaf('tab') || this.app.workspace.getLeaf(true);

    if (!leaf) {
      return;
    }

    await leaf.setViewState({
      type: VIEW_TYPE_TIMEBOX_PLANNER,
      active: true,
    });

    this.app.workspace.revealLeaf(leaf);

    if (leaf.view instanceof TimeboxPlannerView) {
      await leaf.view.reloadFromActiveFile();
    }
  }

  async refreshOpenViews() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMEBOX_PLANNER);

    for (const leaf of leaves) {
      if (leaf.view instanceof TimeboxPlannerView) {
        await leaf.view.reloadFromActiveFile();
      }
    }
  }

  captureLastMarkdownFile() {
    const targetFile = this.resolveTargetFile();

    if (targetFile) {
      this.lastMarkdownFile = targetFile;
    }

    return this.lastMarkdownFile;
  }

  resolveTargetFile() {
    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (activeMarkdownView && activeMarkdownView.file) {
      return activeMarkdownView.file;
    }

    const activeFile = this.app.workspace.getActiveFile();

    if (activeFile) {
      return activeFile;
    }

    const markdownLeaf = this.app.workspace
      .getLeavesOfType('markdown')
      .find((leaf) => leaf.view && leaf.view.file);

    if (markdownLeaf && markdownLeaf.view && markdownLeaf.view.file) {
      return markdownLeaf.view.file;
    }

    return this.lastMarkdownFile;
  }
}

module.exports = TimeboxPlannerPlugin;
