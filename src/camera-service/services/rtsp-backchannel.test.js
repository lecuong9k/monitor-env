import test from "node:test";
import assert from "node:assert/strict";
import { parseBackchannelFromSdp } from "./rtsp-backchannel.client.js";

test("parseBackchannelFromSdp finds sendonly PCMU track", () => {
  const sdp = [
    "v=0",
    "o=- 0 0 IN IP4 127.0.0.1",
    "s=Session",
    "m=video 0 RTP/AVP 96",
    "a=control:rtsp://cam/video",
    "a=recvonly",
    "m=audio 0 RTP/AVP 0",
    "a=control:rtsp://cam/audioback",
    "a=sendonly",
    "a=rtpmap:0 PCMU/8000",
  ].join("\r\n");

  const result = parseBackchannelFromSdp(sdp);
  assert.ok(result);
  assert.equal(result.payloadType, 0);
  assert.equal(result.codec, "PCMU");
  assert.equal(result.control, "rtsp://cam/audioback");
});

test("parseBackchannelFromSdp ignores recvonly audio", () => {
  const sdp = [
    "m=audio 0 RTP/AVP 0",
    "a=control:rtsp://cam/audio",
    "a=recvonly",
    "a=rtpmap:0 PCMU/8000",
  ].join("\r\n");

  assert.equal(parseBackchannelFromSdp(sdp), null);
});
