import type {
  ImageReadingResult,
  ReadingEntry,
} from '@/services/reading-result';

interface StoredImageResult {
  image: HTMLImageElement;
  result: ImageReadingResult;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class ReadingLayer {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private imageResults = new Map<string, StoredImageResult>();
  private highlightEntryId: string | null = null;
  private scheduledRender = 0;

  constructor() {
    this.host = document.createElement('div');
    this.host.setAttribute('data-manga-translator-reading-layer', 'true');
    Object.assign(this.host.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483645',
      pointerEvents: 'none',
    });

    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = `
      ${this.buildStyles()}
      <div id="root">
        <div id="overlay"></div>
        <aside id="panel"></aside>
      </div>
    `;

    document.body.appendChild(this.host);
    this.shadow.addEventListener('mouseover', this.handleMouseOver);
    this.shadow.addEventListener('mouseout', this.handleMouseOut);
    this.shadow.addEventListener('click', this.handleClick);
    window.addEventListener('scroll', this.scheduleRender, true);
    window.addEventListener('resize', this.scheduleRender, true);
  }

  upsert(
    image: HTMLImageElement,
    result: ImageReadingResult
  ): void {
    this.imageResults.set(result.imageKey, { image, result });
    this.render();
  }

  clear(): void {
    this.imageResults.clear();
    this.highlightEntryId = null;
    this.render();
  }

  destroy(): void {
    this.shadow.removeEventListener('mouseover', this.handleMouseOver);
    this.shadow.removeEventListener('mouseout', this.handleMouseOut);
    this.shadow.removeEventListener('click', this.handleClick);
    window.removeEventListener('scroll', this.scheduleRender, true);
    window.removeEventListener('resize', this.scheduleRender, true);
    if (this.scheduledRender) {
      cancelAnimationFrame(this.scheduledRender);
      this.scheduledRender = 0;
    }
    this.host.remove();
  }

  private buildStyles(): string {
    return `
      <style>
        :host {
          all: initial;
        }

        * {
          box-sizing: border-box;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }

        #root {
          position: fixed;
          inset: 0;
          pointer-events: none;
        }

        #overlay {
          position: absolute;
          inset: 0;
        }

        #panel {
          position: absolute;
          top: 16px;
          right: 16px;
          bottom: 16px;
          width: 360px;
          overflow: auto;
          pointer-events: auto;
          background: rgba(15, 23, 42, 0.94);
          color: #e2e8f0;
          border: 1px solid rgba(148, 163, 184, 0.16);
          border-radius: 18px;
          backdrop-filter: blur(18px);
          box-shadow: 0 20px 40px rgba(15, 23, 42, 0.35);
          padding: 14px;
        }

        #panel.is-empty {
          display: none;
        }

        .panel-header {
          position: sticky;
          top: 0;
          z-index: 2;
          background: linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.9));
          padding-bottom: 10px;
          margin-bottom: 12px;
        }

        .panel-title {
          font-size: 14px;
          font-weight: 700;
          color: #f8fafc;
        }

        .panel-subtitle {
          margin-top: 4px;
          font-size: 12px;
          color: #94a3b8;
        }

        .group {
          margin-bottom: 14px;
          padding: 12px;
          border-radius: 14px;
          background: rgba(30, 41, 59, 0.65);
          border: 1px solid rgba(148, 163, 184, 0.08);
        }

        .group-title {
          margin-bottom: 10px;
          font-size: 12px;
          font-weight: 600;
          color: #7dd3fc;
        }

        .entry {
          display: block;
          width: 100%;
          margin-bottom: 8px;
          padding: 10px 12px;
          border: 1px solid rgba(148, 163, 184, 0.1);
          border-radius: 12px;
          background: rgba(15, 23, 42, 0.72);
          color: inherit;
          text-align: left;
          cursor: pointer;
          transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
        }

        .entry:hover,
        .entry.is-active {
          border-color: rgba(34, 211, 238, 0.45);
          background: rgba(15, 23, 42, 0.95);
          transform: translateY(-1px);
        }

        .entry-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
          font-size: 11px;
          color: #94a3b8;
        }

        .entry-index {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 999px;
          background: linear-gradient(135deg, #14b8a6, #06b6d4);
          color: #ecfeff;
          font-weight: 700;
        }

        .entry-text {
          font-size: 13px;
          line-height: 1.6;
          color: #f8fafc;
          white-space: pre-wrap;
        }

        details {
          margin-top: 8px;
        }

        summary {
          cursor: pointer;
          font-size: 11px;
          color: #67e8f9;
          list-style: none;
        }

        summary::-webkit-details-marker {
          display: none;
        }

        .original {
          margin-top: 6px;
          font-size: 12px;
          line-height: 1.5;
          color: #cbd5e1;
          white-space: pre-wrap;
        }

        .anchor {
          position: fixed;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 999px;
          border: 1px solid rgba(236, 254, 255, 0.75);
          background: rgba(15, 23, 42, 0.88);
          color: #ecfeff;
          font-size: 11px;
          font-weight: 700;
          box-shadow: 0 4px 14px rgba(15, 23, 42, 0.28);
          pointer-events: auto;
          cursor: pointer;
        }

        .highlight {
          position: fixed;
          border: 2px solid rgba(34, 211, 238, 0.9);
          background: rgba(34, 211, 238, 0.12);
          border-radius: 8px;
          box-shadow: 0 0 0 1px rgba(255,255,255,0.12) inset;
          pointer-events: none;
        }

        .entry:last-child {
          margin-bottom: 0;
        }
      </style>
    `;
  }

  private render = (): void => {
    const overlay = this.shadow.getElementById('overlay');
    const panel = this.shadow.getElementById('panel');
    if (!overlay || !panel) {
      return;
    }

    overlay.innerHTML = '';

    const groups = [...this.imageResults.values()].filter(
      item => item.image.isConnected && item.result.entries.length > 0
    );

    if (groups.length === 0) {
      panel.classList.add('is-empty');
      panel.innerHTML = '';
      return;
    }

    panel.classList.remove('is-empty');
    panel.innerHTML = `
      <div class="panel-header">
        <div class="panel-title">阅读层</div>
        <div class="panel-subtitle">图上编号锚点与右侧译文一一对应</div>
      </div>
      ${groups
    .map((group, groupIndex) => this.renderGroup(group, groupIndex))
    .join('')}
    `;

    groups.forEach(group => {
      group.result.entries.forEach(entry => {
        const rect = this.getDisplayRect(group.image, entry);
        if (!rect) {
          return;
        }

        const anchor = document.createElement('button');
        anchor.className = 'anchor';
        anchor.setAttribute('data-entry-id', entry.id);
        anchor.style.left = `${rect.left}px`;
        anchor.style.top = `${rect.top}px`;
        anchor.textContent = String(entry.anchorIndex);
        overlay.appendChild(anchor);

        if (this.highlightEntryId === entry.id) {
          const highlight = document.createElement('div');
          highlight.className = 'highlight';
          highlight.style.left = `${rect.left}px`;
          highlight.style.top = `${rect.top}px`;
          highlight.style.width = `${rect.width}px`;
          highlight.style.height = `${rect.height}px`;
          overlay.appendChild(highlight);
        }
      });
    });
  };

  private renderGroup(group: StoredImageResult, groupIndex: number): string {
    return `
      <section class="group" data-image-key="${group.result.imageKey}">
        <div class="group-title">图片 ${groupIndex + 1}</div>
        ${group.result.entries
    .sort((left, right) => left.order - right.order)
    .map(entry => this.renderEntry(entry))
    .join('')}
      </section>
    `;
  }

  private renderEntry(entry: ReadingEntry): string {
    const originalText = entry.originalText.trim();
    return `
      <div class="entry ${this.highlightEntryId === entry.id ? 'is-active' : ''}" data-entry-id="${entry.id}">
        <div class="entry-meta">
          <span class="entry-index">${entry.anchorIndex}</span>
          <span>${entry.status === 'fallback-full-image' ? '整图回退' : '区域翻译'}</span>
        </div>
        <div class="entry-text">${escapeHtml(entry.translatedText)}</div>
        ${originalText
    ? `
          <details>
            <summary>查看原文</summary>
            <div class="original">${escapeHtml(originalText)}</div>
          </details>
        `
    : ''
}
      </div>
    `;
  }

  private getDisplayRect(
    image: HTMLImageElement,
    entry: ReadingEntry
  ): DOMRect | null {
    const rect = image.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const scaleX = rect.width / (image.naturalWidth || rect.width);
    const scaleY = rect.height / (image.naturalHeight || rect.height);
    const { displayRegion } = entry;

    const left = rect.left + displayRegion.x * scaleX;
    const top = rect.top + displayRegion.y * scaleY;
    const width = Math.max(16, displayRegion.width * scaleX);
    const height = Math.max(16, displayRegion.height * scaleY);

    return new DOMRect(left, top, width, height);
  }

  private handleMouseOver = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    const entryId = target?.closest?.('[data-entry-id]')?.getAttribute('data-entry-id');
    if (!entryId) {
      return;
    }
    this.highlightEntryId = entryId;
    this.render();
  };

  private handleMouseOut = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    const related = (event as MouseEvent).relatedTarget as HTMLElement | null;
    const currentId = target?.closest?.('[data-entry-id]')?.getAttribute('data-entry-id');
    const relatedId = related?.closest?.('[data-entry-id]')?.getAttribute('data-entry-id');
    if (currentId && currentId !== relatedId) {
      this.highlightEntryId = null;
      this.render();
    }
  };

  private handleClick = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    const clickable = target?.closest?.('[data-entry-id]') as HTMLElement | null;
    if (!clickable) {
      return;
    }

    const entryId = clickable.getAttribute('data-entry-id');
    if (!entryId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const match = this.findEntry(entryId);
    if (!match) {
      return;
    }

    this.highlightEntryId = entryId;
    this.render();
    this.scrollToEntry(match.image, entryId);
  };

  private findEntry(entryId: string): (StoredImageResult & { entry: ReadingEntry }) | null {
    for (const group of this.imageResults.values()) {
      const entry = group.result.entries.find(item => item.id === entryId);
      if (entry) {
        return { ...group, entry };
      }
    }

    return null;
  }

  private scrollToEntry(image: HTMLImageElement, entryId: string): void {
    image.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    });

    const panelEntry = this.shadow.querySelector(
      `.entry[data-entry-id="${CSS.escape(entryId)}"]`
    ) as HTMLElement | null;
    panelEntry?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }

  private scheduleRender = (): void => {
    if (this.scheduledRender) {
      return;
    }

    this.scheduledRender = requestAnimationFrame(() => {
      this.scheduledRender = 0;
      this.render();
    });
  };
}
