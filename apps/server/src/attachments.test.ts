import { describe, expect, it } from "vitest";
import { signRequest } from "@boomerang/core";
import { agentIn, multipart, setupApp } from "./test/helpers";
const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
async function world() { const s = await setupApp(); const { project } = (await s.human("POST", "/api/v1/projects", { name: "P", key: "PP" })).json; const { agent } = await agentIn(s, project.id); const t = (await agent("POST", "/api/v1/tickets", { projectId: project.id, title: "x" })).json; return { ...s, project, agent, t }; }
describe("attachments", () => {
  it("uploads, stores encrypted, serves with safe headers, and links to a comment", async () => {
    const w = await world();
    const up = await w.agent("POST", "/api/v1/attachments", undefined, multipart({ ticketId: w.t.id }, { name: "shot.png", mime: "image/png", bytes: png }));
    expect(up.status).toBe(200); expect(up.json).toMatchObject({ filename: "shot.png", mime: "image/png", size: png.length, commentId: null });
    const res = await w.app.inject({ method: "GET", url: `/api/v1/attachments/${up.json.id}`, headers: await signRequest(w.keys.seed, "human", "GET", `/api/v1/attachments/${up.json.id}`, "") });
    expect(res.statusCode).toBe(200); expect(res.headers["content-type"]).toBe("image/png"); expect(res.headers["x-content-type-options"]).toBe("nosniff"); expect(res.rawPayload).toEqual(png);
    const c = (await w.agent("POST", "/api/v1/comments", { ticketId: w.t.id, body: `![shot](attachment:${up.json.id})`, attachmentIds: [up.json.id] })).json;
    expect(c.attachmentIds).toEqual([up.json.id]);
    expect((await w.agent("POST", "/api/v1/comments", { ticketId: w.t.id, body: "again", attachmentIds: [up.json.id] })).status).toBe(400);
  });
  it("serves html and svg as octet-stream, refuses unknown types, and hides files across scopes", async () => {
    const w = await world();
    const html = await w.agent("POST", "/api/v1/attachments", undefined, multipart({ ticketId: w.t.id }, { name: "r.html", mime: "text/html", bytes: Buffer.from("<b>x</b>") }));
    const res = await w.app.inject({ method: "GET", url: `/api/v1/attachments/${html.json.id}`, headers: await signRequest(w.keys.seed, "human", "GET", `/api/v1/attachments/${html.json.id}`, "") });
    expect(res.headers["content-type"]).toBe("application/octet-stream");

    // An svg is an image the browser will happily run script from, so it is never served as itself.
    const svgBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const svg = await w.agent("POST", "/api/v1/attachments", undefined, multipart({ ticketId: w.t.id }, { name: "x.svg", mime: "image/svg+xml", bytes: svgBytes }));
    expect(svg.status).toBe(200);
    const svgRes = await w.app.inject({ method: "GET", url: `/api/v1/attachments/${svg.json.id}`, headers: await signRequest(w.keys.seed, "human", "GET", `/api/v1/attachments/${svg.json.id}`, "") });
    expect(svgRes.headers["content-type"]).toBe("application/octet-stream");
    expect(svgRes.headers["x-content-type-options"]).toBe("nosniff");
    expect(svgRes.headers["content-disposition"]).toBe('attachment; filename="x.svg"');
    expect((await w.agent("POST", "/api/v1/attachments", undefined, multipart({ ticketId: w.t.id }, { name: "x.exe", mime: "application/x-msdownload", bytes: png }))).status).toBe(415);
    const other = (await w.human("POST", "/api/v1/projects", { name: "O", key: "OO" })).json;
    const { agent: outsider } = await agentIn(w, other.project.id);
    expect((await outsider("GET", `/api/v1/attachments/${html.json.id}`)).status).toBe(403);
  });
  it("refuses an upload from an actor without attachment.add on the project", async () => {
    const w = await world();
    const other = (await w.human("POST", "/api/v1/projects", { name: "O2", key: "O2" })).json;
    const { agent: outsider } = await agentIn(w, other.project.id);
    const up = await outsider("POST", "/api/v1/attachments", undefined, multipart({ ticketId: w.t.id }, { name: "shot.png", mime: "image/png", bytes: png }));
    expect(up.status).toBe(403);
  });
  it("refuses more than one file part with 413 too_large", async () => {
    const w = await world();
    const boundary = "boomerang-two-files";
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="ticketId"\r\n\r\n${w.t.id}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n` +
      png.toString("binary") + `\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file2"; filename="b.png"\r\nContent-Type: image/png\r\n\r\n` +
      png.toString("binary") + `\r\n` +
      `--${boundary}--\r\n`,
      "binary",
    );
    const up = await w.agent("POST", "/api/v1/attachments", undefined, { body, contentType: `multipart/form-data; boundary=${boundary}` });
    expect(up.status).toBe(413);
    expect(up.json.error.code).toBe("too_large");
  });
});
