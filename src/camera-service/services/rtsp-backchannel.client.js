import crypto from "crypto";
import net from "net";
import g711 from "g711";

const { alawFromPCM, ulawFromPCM } = g711;

const BACKCHANNEL_REQUIRE = "www.onvif.org/ver20/backchannel";
const SAMPLES_PER_PACKET = 160;
const PCM_FRAME_BYTES = SAMPLES_PER_PACKET * 2;
const USER_AGENT = "monitor-env-talkback/1.0";

/** @typedef {{ hostname: string; port: number; username: string; password: string; path: string; baseUrl: string }} RtspParts */

/** @param {string} url */
function parseRtspUrl(url) {
  const parsed = new URL(url);
  const port = Number(parsed.port || 554);
  const path = `${parsed.pathname}${parsed.search}`;
  return {
    hostname: parsed.hostname,
    port,
    username: decodeURIComponent(parsed.username || ""),
    password: decodeURIComponent(parsed.password || ""),
    path: path || "/",
    baseUrl: `rtsp://${parsed.hostname}:${port}${path || "/"}`,
  };
}

/** @param {string} control @param {string} baseUrl @param {string} path */
function resolveControlUrl(control, baseUrl, path) {
  const trimmed = String(control || "").trim();
  if (!trimmed) return baseUrl;
  if (trimmed.startsWith("rtsp://")) return trimmed;
  if (trimmed.startsWith("/")) {
    const u = new URL(baseUrl);
    return `rtsp://${u.hostname}:${u.port || 554}${trimmed}`;
  }
  const base = baseUrl.replace(/\/$/, "");
  const parent = base.includes("/")
    ? base.slice(0, base.lastIndexOf("/"))
    : base;
  return `${parent}/${trimmed}`;
}

/**
 * @param {string} sdp
 * @returns {{ control: string; payloadType: number; codec: string } | null}
 */
export function parseBackchannelFromSdp(sdp) {
  const normalized = sdp.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\nm=").slice(1);

  for (const block of blocks) {
    const section = `m=${block}`;
    const lines = section.split("\n");
    if (!lines[0]?.startsWith("m=audio")) continue;

    const attrs = lines.slice(1);
    const sendonly = attrs.some((line) => line.trim() === "a=sendonly");
    if (!sendonly) continue;

    let control = "";
    /** @type {{ pt: number; codec: string }[]} */
    const codecs = [];

    for (const line of attrs) {
      const trimmed = line.trim();
      if (trimmed.startsWith("a=control:")) {
        control = trimmed.slice("a=control:".length);
      }
      const rtpmap = trimmed.match(/^a=rtpmap:(\d+)\s+(\S+)/i);
      if (rtpmap) {
        codecs.push({
          pt: Number(rtpmap[1]),
          codec: rtpmap[2].split("/")[0].toUpperCase(),
        });
      }
    }

    const mMatch = lines[0].match(/^m=audio\s+\S+\s+\S+\s+(.+)$/);
    if (mMatch) {
      for (const token of mMatch[1].trim().split(/\s+/)) {
        const pt = Number(token);
        if (!Number.isFinite(pt)) continue;
        if (!codecs.some((c) => c.pt === pt)) {
          codecs.push({
            pt,
            codec: pt === 0 ? "PCMU" : pt === 8 ? "PCMA" : "UNKNOWN",
          });
        }
      }
    }

    const preferred = [
      "PCMU",
      "PCMA",
      "G726-16",
      "G726-24",
      "G726-32",
      "G726-40",
    ];
    let chosen = null;
    for (const name of preferred) {
      chosen = codecs.find((c) => c.codec === name || c.codec.startsWith(name));
      if (chosen) break;
    }
    if (!chosen && codecs.length > 0) chosen = codecs[0];
    if (!chosen) continue;

    return {
      control,
      payloadType: chosen.pt,
      codec: chosen.codec,
    };
  }

  return null;
}

function md5(value) {
  return crypto.createHash("md5").update(value).digest("hex");
}

/** @param {string} header @param {string} method @param {string} uri @param {RtspParts} parts */
function buildDigestAuth(header, method, uri, parts) {
  const params = {};
  for (const piece of header.replace(/^Digest\s+/i, "").split(",")) {
    const m = piece.trim().match(/^(\w+)="?([^"]+)"?$/);
    if (m) params[m[1]] = m[2];
  }

  const ha1 = md5(`${parts.username}:${params.realm}:${parts.password}`);
  const ha2 = md5(`${method}:${uri}`);
  let response;
  if (params.qop) {
    const nc = "00000001";
    const cnonce = crypto.randomBytes(8).toString("hex");
    response = md5(
      `${ha1}:${params.nonce}:${nc}:${cnonce}:${params.qop}:${ha2}`,
    );
    return (
      `Digest username="${parts.username}", realm="${params.realm}", nonce="${params.nonce}", ` +
      `uri="${uri}", qop=${params.qop}, nc=${nc}, cnonce="${cnonce}", response="${response}"`
    );
  }

  response = md5(`${ha1}:${params.nonce}:${ha2}`);
  return (
    `Digest username="${parts.username}", realm="${params.realm}", nonce="${params.nonce}", ` +
    `uri="${uri}", response="${response}"`
  );
}

function basicAuth(parts) {
  if (!parts.username) return null;
  const token = Buffer.from(`${parts.username}:${parts.password}`).toString(
    "base64",
  );
  return `Basic ${token}`;
}

export class RtspBackchannelClient {
  /** @param {string} rtspUrl */
  constructor(rtspUrl) {
    this.parts = parseRtspUrl(rtspUrl);
    /** @type {net.Socket | null} */
    this.socket = null;
    this.cseq = 1;
    /** @type {string | null} */
    this.session = null;
    /** @type {{ control: string; payloadType: number; codec: string } | null} */
    this.backchannel = null;
    this.interleavedChannel = 0;
    this.sequence = 0;
    this.timestamp = 0;
    this.ssrc = crypto.randomBytes(4).readUInt32BE(0);
    /** @type {Buffer} */
    this.readBuffer = Buffer.alloc(0);
    /** @type {((value: { status: number; headers: Record<string, string>; body: string }) => void) | null} */
    this.pendingResponse = null;
    /** @type {((err: Error) => void) | null} */
    this.pendingReject = null;
    this.closed = false;
    this.playing = false;
  }

  /** @param {Buffer} chunk */
  #appendBuffer(chunk) {
    this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
    this.#drainBuffer();
  }

  #drainBuffer() {
    while (this.readBuffer.length > 0) {
      if (this.readBuffer[0] === 0x24) {
        if (this.readBuffer.length < 4) return;
        const length = this.readBuffer.readUInt16BE(2);
        if (this.readBuffer.length < 4 + length) return;
        this.readBuffer = this.readBuffer.subarray(4 + length);
        continue;
      }

      const headerEnd = this.readBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const headerText = this.readBuffer
        .subarray(0, headerEnd)
        .toString("utf8");
      const lines = headerText.split("\r\n");
      const statusLine = lines[0] || "";
      const statusMatch = statusLine.match(/^RTSP\/\d\.\d\s+(\d+)/);
      if (!statusMatch) {
        this.readBuffer = this.readBuffer.subarray(headerEnd + 4);
        continue;
      }

      /** @type {Record<string, string>} */
      const headers = {};
      for (const line of lines.slice(1)) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        headers[line.slice(0, idx).trim().toLowerCase()] = line
          .slice(idx + 1)
          .trim();
      }

      const contentLength = Number(headers["content-length"] || 0);
      const total = headerEnd + 4 + contentLength;
      if (this.readBuffer.length < total) return;

      const body = this.readBuffer
        .subarray(headerEnd + 4, total)
        .toString("utf8");
      this.readBuffer = this.readBuffer.subarray(total);

      const resolve = this.pendingResponse;
      const reject = this.pendingReject;
      this.pendingResponse = null;
      this.pendingReject = null;

      if (resolve) {
        resolve({
          status: Number(statusMatch[1]),
          headers,
          body,
        });
      } else if (reject) {
        reject(new Error(`RTSP response không mong đợi: ${statusLine}`));
      }
    }
  }

  /** @param {string} method @param {string} uri @param {Record<string, string>} extraHeaders @param {string} [body] @param {string | null} [authHeader] */
  #buildRequest(method, uri, extraHeaders = {}, body = "", authHeader = null) {
    const lines = [
      `${method} ${uri} RTSP/1.0`,
      `CSeq: ${this.cseq++}`,
      `User-Agent: ${USER_AGENT}`,
    ];

    if (authHeader) lines.push(`Authorization: ${authHeader}`);
    for (const [key, value] of Object.entries(extraHeaders)) {
      lines.push(`${key}: ${value}`);
    }
    if (body) lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
    lines.push("", body);
    return lines.join("\r\n");
  }

  /** @param {string} method @param {string} uri @param {Record<string, string>} [extraHeaders] @param {string} [body] */
  async #request(method, uri, extraHeaders = {}, body = "") {
    if (!this.socket || this.closed) {
      throw new Error("RTSP chưa kết nối");
    }

    let authHeader =
      this.parts.username && !extraHeaders.Authorization
        ? basicAuth(this.parts)
        : null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const payload = this.#buildRequest(
        method,
        uri,
        extraHeaders,
        body,
        authHeader,
      );
      const response = await new Promise((resolve, reject) => {
        this.pendingResponse = resolve;
        this.pendingReject = reject;
        this.socket.write(payload, (err) => {
          if (err) reject(err);
        });
      });

      if (response.status !== 401 || attempt === 1) {
        return response;
      }

      const wwwAuth = response.headers["www-authenticate"] || "";
      if (!wwwAuth.toLowerCase().startsWith("digest")) {
        throw new Error(`RTSP auth thất bại (${response.status})`);
      }
      authHeader = buildDigestAuth(wwwAuth, method, uri, this.parts);
    }

    throw new Error("RTSP auth thất bại");
  }

  async connect() {
    await this.#openSocket();

    const describe = await this.#request("DESCRIBE", this.parts.baseUrl, {
      Accept: "application/sdp",
      Require: BACKCHANNEL_REQUIRE,
    });

    if (describe.status === 551) {
      throw new Error("Camera không hỗ trợ ONVIF back channel");
    }
    if (describe.status < 200 || describe.status >= 300) {
      throw new Error(`RTSP DESCRIBE thất bại (${describe.status})`);
    }

    this.backchannel = parseBackchannelFromSdp(describe.body);
    if (!this.backchannel) {
      throw new Error("SDP không có audio back channel (sendonly)");
    }

    const setupUrl = resolveControlUrl(
      this.backchannel.control,
      this.parts.baseUrl,
      this.parts.path,
    );

    const setup = await this.#request("SETUP", setupUrl, {
      Transport: `RTP/AVP/TCP;unicast;interleaved=${this.interleavedChannel}-${this.interleavedChannel + 1}`,
      Require: BACKCHANNEL_REQUIRE,
    });

    if (setup.status < 200 || setup.status >= 300) {
      throw new Error(`RTSP SETUP thất bại (${setup.status})`);
    }

    this.session = setup.headers.session?.split(";")[0]?.trim() || null;
    if (!this.session) {
      throw new Error("RTSP SETUP không trả Session");
    }

    const play = await this.#request("PLAY", this.parts.baseUrl, {
      Session: this.session,
      Range: "npt=0.000-",
    });

    if (play.status < 200 || play.status >= 300) {
      throw new Error(`RTSP PLAY thất bại (${play.status})`);
    }

    this.playing = true;
  }

  /** @param {Buffer} pcm16le */
  sendPcm(pcm16le) {
    if (!this.playing || !this.backchannel || !this.socket || this.closed)
      return;
    if (pcm16le.length < PCM_FRAME_BYTES) return;

    const samples = pcm16le.subarray(0, PCM_FRAME_BYTES);
    let encoded;
    if (
      this.backchannel.codec === "PCMA" ||
      this.backchannel.payloadType === 8
    ) {
      encoded = Buffer.from(alawFromPCM(samples));
    } else {
      encoded = Buffer.from(ulawFromPCM(samples));
    }

    const rtp = Buffer.alloc(12 + encoded.length);
    rtp[0] = 0x80;
    rtp[1] = this.backchannel.payloadType & 0x7f;
    rtp.writeUInt16BE(this.sequence & 0xffff, 2);
    this.sequence = (this.sequence + 1) & 0xffff;
    rtp.writeUInt32BE(this.timestamp >>> 0, 4);
    this.timestamp = (this.timestamp + SAMPLES_PER_PACKET) >>> 0;
    rtp.writeUInt32BE(this.ssrc >>> 0, 8);
    encoded.copy(rtp, 12);

    const frame = Buffer.alloc(4 + rtp.length);
    frame[0] = 0x24;
    frame[1] = this.interleavedChannel;
    frame.writeUInt16BE(rtp.length, 2);
    rtp.copy(frame, 4);
    this.socket.write(frame);
  }

  async teardown() {
    if (!this.socket || this.closed) return;

    try {
      if (this.session) {
        await this.#request("TEARDOWN", this.parts.baseUrl, {
          Session: this.session,
        });
      }
    } catch {
      // ignore teardown errors
    } finally {
      this.closed = true;
      this.playing = false;
      this.socket.destroy();
      this.socket = null;
    }
  }

  async #openSocket() {
    if (this.socket) return;
    await new Promise((resolve, reject) => {
      const socket = net.connect(
        { host: this.parts.hostname, port: this.parts.port },
        resolve,
      );
      socket.setNoDelay(true);
      socket.on("data", (chunk) => this.#appendBuffer(chunk));
      socket.on("error", (err) => {
        if (this.pendingReject) {
          this.pendingReject(err);
          this.pendingReject = null;
          this.pendingResponse = null;
        }
      });
      socket.on("close", () => {
        this.closed = true;
        this.playing = false;
      });
      this.socket = socket;
      socket.once("error", reject);
    });
  }

  /**
   * Probe ONVIF back channel availability via RTSP DESCRIBE.
   * @returns {Promise<{ supported: boolean; codecs: string[]; reason?: string }>}
   */
  async probe() {
    try {
      await this.#openSocket();
      const describe = await this.#request("DESCRIBE", this.parts.baseUrl, {
        Accept: "application/sdp",
        Require: BACKCHANNEL_REQUIRE,
      });

      if (describe.status === 551) {
        return {
          supported: false,
          codecs: [],
          reason: "Camera không hỗ trợ ONVIF back channel",
        };
      }
      if (describe.status < 200 || describe.status >= 300) {
        return {
          supported: false,
          codecs: [],
          reason: `RTSP DESCRIBE thất bại (${describe.status})`,
        };
      }

      const backchannel = parseBackchannelFromSdp(describe.body);
      if (!backchannel) {
        return {
          supported: false,
          codecs: [],
          reason: "SDP không có audio back channel",
        };
      }

      return {
        supported: true,
        codecs: [backchannel.codec],
      };
    } catch (err) {
      return {
        supported: false,
        codecs: [],
        reason:
          err instanceof Error ? err.message : "Không thể probe back channel",
      };
    } finally {
      await this.teardown();
    }
  }
}

/**
 * @param {string} rtspUrl
 * @returns {Promise<{ supported: boolean; codecs: string[]; reason?: string }>}
 */
export async function probeRtspBackchannel(rtspUrl) {
  const client = new RtspBackchannelClient(rtspUrl);
  return client.probe();
}
