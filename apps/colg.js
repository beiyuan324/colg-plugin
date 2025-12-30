import fetch from "node-fetch";
import common from "../../../lib/common/common.js";

let cheerio;
try {
  cheerio = await import("cheerio");
} catch {}

export class Colg extends plugin {
  constructor() {
    super({
      name: "COLG解析",
      dsc: "#colg <tid或链接>",
      event: "message",
      priority: 5000,
      rule: [
        {
          reg: "^#colg(\\s+.+)?$",
          fnc: "colg",
        },
      ],
    });
  }

  async accept() {
    const msg = this.e?.msg || "";
    if (!msg) return false;
    if (/^#colg(\s|$)/i.test(msg)) return false;

    const url = msg.match(/https?:\/\/\S+/i)?.[0] || "";
    if (!url) return false;

    if (!/bbs\.colg\.cn\/(forum\.php\?mod=viewthread|thread-\d+-)/i.test(url)) return false;

    await this.handleColgInput(url);
    return "return";
  }

  async colg() {
    const input = (this.e.msg || "").replace(/^#colg\s*/i, "").trim();
    if (!input) {
      await this.reply("请提供COLG帖子tid或链接，例如：#colg 9549504");
      return true;
    }

    await this.handleColgInput(input);

    return true;
  }

  async handleColgInput(input) {
    const { tid, url } = this.parseTidOrUrl(input);
    if (!tid && !url) {
      await this.reply("未识别到tid或链接，请重试");
      return;
    }

    try {
      const tryUrls = [];
      if (tid) {
        tryUrls.push(this.buildThreadUrl(tid));
        tryUrls.push(this.buildAltThreadUrl(tid));
      }
      if (url) tryUrls.push(url);

      let best = { title: "", text: "", images: [], usedUrl: tryUrls[0] };
      for (const u of [...new Set(tryUrls)].filter(Boolean)) {
        const html = await this.fetchHtml(u);
        const parsed = this.parseThread(html);
        best = {
          ...parsed,
          usedUrl: u,
        };
        if (best.text || (best.images && best.images.length)) break;
      }

      const forwardTitle = best.title ? `COLG帖子：${best.title}` : "COLG帖子";
      const forwardMsgs = [];

      forwardMsgs.push(`${forwardTitle}\n${best.usedUrl}`);

      if (best.text) {
        for (const chunk of this.splitText(best.text, 1200)) {
          forwardMsgs.push(chunk);
        }
      } else {
        forwardMsgs.push("未解析到正文内容（可能需要登录或页面结构变化）");
      }

      if (best.images && best.images.length) {
        const batches = this.chunkArray(best.images, 6);
        for (const batch of batches) {
          forwardMsgs.push(batch.map(u => segment.image(u)));
        }
      } else {
        forwardMsgs.push("未解析到图片");
      }

      const forward = common.makeForwardMsg(this.e, forwardMsgs, forwardTitle);
      await this.reply(forward);
    } catch (err) {
      logger.error(err);
      await this.reply(`解析失败：${err?.message || err}`);
    }
  }

  parseTidOrUrl(input) {
    const urlMatch = input.match(/https?:\/\/\S+/i);
    const rawUrl = urlMatch ? urlMatch[0] : "";

    if (rawUrl) {
      const tidFromQuery = rawUrl.match(/[?&]tid=(\d+)/i)?.[1];
      if (tidFromQuery) return { tid: tidFromQuery, url: "" };

      const tidFromPath = rawUrl.match(/thread-(\d+)-/i)?.[1];
      if (tidFromPath) return { tid: tidFromPath, url: "" };

      return { tid: "", url: rawUrl };
    }

    const tid = input.match(/\d+/)?.[0] || "";
    return { tid, url: "" };
  }

  buildThreadUrl(tid) {
    return `https://bbs.colg.cn/thread-${tid}-1-1.html`;
  }

  buildAltThreadUrl(tid) {
    return `https://bbs.colg.cn/forum.php?mod=viewthread&tid=${tid}&page=1&mobile=no`;
  }

  async fetchHtml(url) {
    const resp = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    if (!resp.ok) {
      throw new Error(`请求失败：${resp.status} ${resp.statusText}`);
    }

    const html = await resp.text();
    if (!html) throw new Error("页面内容为空");
    return html;
  }

  parseThread(html) {
    if (cheerio?.load) {
      const $ = cheerio.load(html);

      const title = this.pickFirstText($, [
        "h1#thread_subject",
        "h1.subject",
        "h1",
        "title",
      ])
        .replace(/\s+/g, " ")
        .trim();

      const content = this.findMainContent($);
      if (!content) {
        return { title, text: "", images: [] };
      }

      const images = this.extractImages($, content);
      const text = this.extractText($, content);

      return { title, text, images };
    }

    return this.parseThreadFallback(html);
  }

  parseThreadFallback(html) {
    const title = this.htmlToText(
      html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
        html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
        ""
    )
      .replace(/\s+/g, " ")
      .trim();

    const contentHtml = this.pickMainContentHtml(html);
    if (!contentHtml) return { title, text: "", images: [] };

    const base = "https://bbs.colg.cn";
    const imgRe = /<img\b[^>]*(?:file|zoomfile|src)=["']([^"']+)["'][^>]*>/gi;
    const images = [];
    let m;
    while ((m = imgRe.exec(contentHtml))) {
      const abs = this.toAbsUrl((m[1] || "").trim(), base);
      if (abs) images.push(abs);
    }

    const text = this.htmlToText(contentHtml)
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return { title, text, images: [...new Set(images)] };
  }

  pickMainContentHtml(html) {
    const startMatch = html.match(/<[^>]+\bid=["']postmessage_\d+["'][^>]*>/i);
    if (!startMatch) return "";

    const startIdx = startMatch.index;
    const openTag = startMatch[0];
    const afterOpen = html.slice(startIdx + openTag.length);

    const endCandidates = [
      afterOpen.search(/<div\b[^>]*class=["'][^"']*(postattach|postattachlist|attach)[^"']*["'][^>]*>/i),
      afterOpen.search(/<div\b[^>]*id=["']comment/i),
      afterOpen.search(/<div\b[^>]*class=["'][^"']*(modact|sign)[^"']*["'][^>]*>/i),
      afterOpen.search(/<\/td>/i),
    ].filter(i => i >= 0);

    const endIdx = endCandidates.length ? Math.min(...endCandidates) : Math.min(afterOpen.length, 150000);
    return afterOpen.slice(0, endIdx);
  }

  htmlToText(html) {
    if (!html) return "";

    const withBreaks = html
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      .replace(/<\s*\/p\s*>/gi, "\n")
      .replace(/<\s*p\b[^>]*>/gi, "")
      .replace(/<\s*\/div\s*>/gi, "\n")
      .replace(/<\s*div\b[^>]*>/gi, "")
      .replace(/<\s*\/li\s*>/gi, "\n")
      .replace(/<\s*li\b[^>]*>/gi, "- ");

    const stripped = withBreaks.replace(/<[^>]+>/g, "");
    return this.decodeHtmlEntities(stripped)
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n");
  }

  decodeHtmlEntities(str) {
    if (!str) return "";
    return str
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => {
        const code = Number(n);
        if (!Number.isFinite(code)) return _;
        try {
          return String.fromCodePoint(code);
        } catch {
          return _;
        }
      })
      .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => {
        const code = parseInt(n, 16);
        if (!Number.isFinite(code)) return _;
        try {
          return String.fromCodePoint(code);
        } catch {
          return _;
        }
      });
  }

  pickFirstText($, selectors) {
    for (const sel of selectors) {
      const t = $(sel).first().text()?.trim();
      if (t) return t;
    }
    return "";
  }

  findMainContent($) {
    const selectors = [
      'div[id^="postmessage_"]',
      "div.postmessage",
      "div.message",
      "div.t_fsz",
      "div.pcb div.t_fsz",
    ];

    for (const sel of selectors) {
      const el = $(sel).first();
      if (el && el.length) return el;
    }

    return null;
  }

  extractImages($, contentEl) {
    const base = "https://bbs.colg.cn";

    const urls = [];
    contentEl.find("img").each((_, img) => {
      const $img = $(img);
      const u = (
        $img.attr("file") ||
        $img.attr("zoomfile") ||
        $img.attr("src") ||
        ""
      ).trim();
      if (!u) return;

      const abs = this.toAbsUrl(u, base);
      if (!abs) return;

      urls.push(abs);
    });

    return [...new Set(urls)];
  }

  extractText($, contentEl) {
    const cloned = contentEl.clone();
    cloned.find("script, style").remove();

    cloned.find("br").replaceWith("\n");

    const raw = cloned.text() || "";
    const text = raw
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

    return text;
  }

  toAbsUrl(u, base) {
    if (!u) return "";
    if (u.startsWith("data:")) return "";

    if (u.startsWith("//")) return `https:${u}`;
    if (u.startsWith("http://") || u.startsWith("https://")) return u;
    if (u.startsWith("/")) return `${base}${u}`;

    try {
      return new URL(u, `${base}/`).toString();
    } catch {
      return "";
    }
  }

  splitText(text, maxLen) {
    if (!text) return [];
    if (text.length <= maxLen) return [text];

    const parts = [];
    let cur = "";
    for (const line of text.split("\n")) {
      const next = cur ? `${cur}\n${line}` : line;
      if (next.length > maxLen) {
        if (cur) parts.push(cur);
        cur = line;
      } else {
        cur = next;
      }
    }
    if (cur) parts.push(cur);

    return parts.filter(Boolean);
  }

  chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }
}
