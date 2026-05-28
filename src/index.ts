import express from "express";
import { Client } from "@hubspot/api-client";
import { scrape } from "./scrape.js";

const hubspot = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN!.trim(),
});
const listId = process.env.HUBSPOT_SEGMENT_ID || "395";

const app = express();
app.use(express.json());

app.post("/webhook", (req, res) => {
  res.sendStatus(200);
  void (async () => {
    const payload = (Array.isArray(req.body) ? req.body[0] : req.body) as Record<
      string,
      unknown
    >;
    if (!payload || typeof payload !== "object") return;
    if (payload.listId && String(payload.listId) !== listId) return;

    const properties = payload.properties as
      | Record<string, { value?: unknown }>
      | undefined;
    const companyId = String(
      properties?.hs_object_id?.value ??
        payload.companyId ??
        payload.hs_object_id ??
        "",
    ).trim();
    if (!companyId) return;

    let companyName =
      properties?.name?.value != null ? String(properties.name.value) : "";
    if (!companyName) {
      companyName = String(
        (await hubspot.crm.companies.basicApi.getById(companyId, ["name"]))
          .properties?.name || "Unknown",
      );
    }

    for (const person of await scrape(companyName)) {
      if (!person.name.trim()) continue;
      const nameParts = person.name.trim().split(/\s+/);
      let phoneDigits = (person.phone || "").replace(/\D/g, "");
      if (phoneDigits.startsWith("47")) phoneDigits = phoneDigits.slice(2);
      const phone = phoneDigits ? `+47${phoneDigits}` : undefined;
      try {
        const contact = await hubspot.crm.contacts.basicApi.create({
          properties: {
            firstname: nameParts[0] ?? "Kontakt",
            lastname: nameParts.slice(1).join(" ") || ".",
            jobtitle: person.role,
            company: companyName,
            ...(phone ? { phone } : {}),
          },
        });
        await hubspot.crm.associations.v4.basicApi.createDefault(
          "contacts",
          contact.id,
          "companies",
          companyId,
        );
      } catch (error) {
        console.log(error);
      }
    }
  })().catch(() => {});
});

const port = Number(process.env.PORT ?? 8000);
app.listen(port, () => console.log(`Webhook listening on http://localhost:${port}/webhook`));
