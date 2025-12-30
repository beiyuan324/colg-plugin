import fetch from "node-fetch";
import md5 from "md5";

export class DnfRate extends plugin {
  constructor() {
    super({
      name: "DNF跨区比例",
      dsc: "#DNF跨二比例",
      event: "message",
      priority: 5000,
      rule: [
        {
          reg: "^#[dD][nN][fF]跨([\\d一二三四五六七八九十]+|[3三][aAbB])比例$",
          fnc: "dnfRate",
        },
      ],
    });
  }

  async dnfRate() {
    const msg = (this.e?.msg || "").trim();
    const match = msg.match(/^#[dD][nN][fF]跨([\d一二三四五六七八九十]+|[3三][aAbB])比例$/);
    const areaInput = match?.[1] || "";
    const area = this.normalizeCrossArea(areaInput);
    if (!area) {
      await this.reply("未识别到跨区编号，请使用格式：#DNF跨二比例");
      return true;
    }

    try {
      const { list, url } = await this.fetchDnfRates(area.slug);
      if (!list.length) {
        await this.reply(`未解析到跨${area.display}的比例数据，可能页面结构已变更`);
        return true;
      }

      const lines = list
        .slice(0, 8)
        .flatMap(item => {
          const head = `${item.platform}：${item.ratioText}（${item.count || 0}单）`;
          const detail =
            item.money != null && item.amount != null
              ? `参考单：${item.money}元 / ${item.amount}万`
              : "";
          const link = item.buyUrl ? `链接：${item.buyUrl}` : "";

          return [
            [head, detail].filter(Boolean).join(" "),
            link,
          ].filter(Boolean);
        });
      const out = [`DNF 跨${area.display}比例（按最低价排序）`, ...lines, `来源：${url}`].join("\n");
      await this.reply(out);
    } catch (err) {
      logger.error(err);
      await this.reply(`查询失败：${err?.message || err}`);
    }

    return true;
  }

  normalizeCrossArea(input) {
    const raw = String(input || "").trim();
    if (!raw) return null;

    const ab = raw.match(/^([3三])([aAbB])$/);
    if (ab) {
      const suffix = ab[2].toLowerCase();
      return { slug: `kua3${suffix}`, display: `3${suffix.toUpperCase()}` };
    }

    const arabic = Number(input);
    if (!Number.isNaN(arabic) && arabic > 0) {
      return { slug: `kua${arabic}`, display: arabic };
    }

    const cnMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

    if (/^[一二三四五六七八九]$/.test(input)) {
      const n = cnMap[input];
      return { slug: `kua${n}`, display: n };
    }

    if (input === "十") return { slug: "kua10", display: 10 };

    if (/^十[一二三四五六七八九]$/.test(input)) {
      const n = 10 + cnMap[input[1]];
      return { slug: `kua${n}`, display: n };
    }

    if (/^[一二三四五六七八九]十$/.test(input)) {
      const n = cnMap[input[0]] * 10;
      return { slug: `kua${n}`, display: n };
    }

    if (/^[一二三四五六七八九]十[一二三四五六七八九]$/.test(input)) {
      const n = cnMap[input[0]] * 10 + cnMap[input[2]];
      return { slug: `kua${n}`, display: n };
    }

    return null;
  }

  async fetchDnfRates(slug) {
    const url = `https://www.yxdr.com/bijiaqi/dnf/youxibi/${slug}`;
    const html = await this.fetchHtml(url);
    const configJsUrl = this.extractConfigJsUrl(html);
    if (!configJsUrl) {
      throw new Error("未找到配置脚本（CoinSale_yxb_*.js），可能页面结构已变更");
    }

    const chanels = await this.fetchConfigChanels(configJsUrl);
    const list = await this.fetchCoinsaleLowestByPlatform(chanels);
    return { list, url };
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

  extractConfigJsUrl(html = "") {
    if (!html) return "";

    const m = html.match(/https?:\/\/www\.yxdr\.com\/cate\/1838\/CoinSale_yxb_\d+_0\.js(?:\?ver=\d+)?/i);
    if (m?.[0]) return m[0];

    const m2 = html.match(/\/cate\/1838\/CoinSale_yxb_\d+_0\.js(?:\?ver=\d+)?/i);
    if (m2?.[0]) return `https://www.yxdr.com${m2[0]}`;

    return "";
  }

  async fetchConfigChanels(configJsUrl) {
    const resp = await fetch(configJsUrl, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "text/plain,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    if (!resp.ok) {
      throw new Error(`请求配置失败：${resp.status} ${resp.statusText}`);
    }

    const text = await resp.text();
    if (!text) throw new Error("配置脚本内容为空");

    const jsonStr = this.subString(text, "window.bijiaqiChanels=", "];") + "]";
    let list;
    try {
      list = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error("解析配置脚本失败");
    }

    if (!Array.isArray(list) || !list.length) return [];
    return list;
  }

  async fetchCoinsaleLowestByPlatform(chanels = []) {
    let bestByPlatform = new Map();

    for (const ch of chanels) {
      const dataStr = ch?.data;
      const sign = ch?.sign;
      if (!dataStr || !sign) continue;

      let data;
      try {
        data = JSON.parse(dataStr);
      } catch {
        continue;
      }

      if (data?.CoinNo && String(data.CoinNo).toLowerCase() !== "yxb") {
        continue;
      }

      const pfId = data?.PfId;
      const pfName = data?.PfName;
      const gId = data?.GId;
      const gsId = data?.GsId;

      if (!pfId || !pfName || !gId || !gsId) continue;

      const token = await this.getToken(String(gId), String(gsId));
      const time = token?.time;
      const secret = token?.secret;
      if (!time || !secret) continue;

      const req = {
        data: dataStr,
        sign,
        cross: 0,
        time,
        secret: md5(`${secret}_${pfId}_${sign}`),
      };

      const res = await this.postJson("https://www.yxdr.com/bijia/coinsale", req);
      let orders = [];
      if (Array.isArray(res?.data)) {
        orders = res.data;
      } else if (typeof res?.data === "string" && res.data.trim()) {
        try {
          const parsed = JSON.parse(res.data);
          if (Array.isArray(parsed)) orders = parsed;
        } catch {}
      }
      if (!orders.length) continue;

      for (const order of orders) {
        const amount = Number(order?.Amount);
        const money = Number(order?.Money);
        if (!Number.isFinite(amount) || !Number.isFinite(money) || money <= 0) continue;
        const bl = Math.round((amount / money) * 100) / 100;
        if (!Number.isFinite(bl) || bl <= 0) continue;

        let exist = bestByPlatform.get(pfName);
        if (!exist) {
          exist = { platform: pfName, ratioText: "", bl: 0, count: 0, buyUrl: "", money: null, amount: null };
          bestByPlatform.set(pfName, exist);
        }

        exist.count += 1;

        if (bl > exist.bl) {
          exist.bl = bl;
          exist.ratioText = `${bl}万金币/元`;
          exist.buyUrl = order?.BuyUrl || order?.buyUrl || order?.url || "";
          exist.money = order?.Money ?? null;
          exist.amount = order?.Amount ?? null;
        }
      }
    }

    return Array.from(bestByPlatform.values())
      .filter(v => Number(v?.bl) > 0)
      .sort((a, b) => b.bl - a.bl);
  }

  async getToken(GId, GsId) {
    const body = { GId, GsId };
    return await this.postJson("https://www.yxdr.com/bijia/coinsalesecret", body);
  }

  async postJson(url, body) {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(`请求失败：${resp.status} ${resp.statusText}`);
    }

    const text = await resp.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  subString(str, left, right) {
    if (!str) return "";
    const li = str.indexOf(left);
    if (li < 0) return "";
    const start = li + left.length;
    const ri = str.indexOf(right, start);
    if (ri < 0) return "";
    return str.substring(start, ri);
  }
}
