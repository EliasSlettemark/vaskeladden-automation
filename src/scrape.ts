import puppeteerCore from "puppeteer-core";
import { addExtra } from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

export async function scrape(company: string) {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_EXECUTABLE_PATH,
    protocolTimeout: 180_000,
    headless: process.env.HEADLESS !== "false",
    args: ["--lang=nb-NO", "--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ "Accept-Language": "nb-NO,nb;q=0.9" });
  await page.setDefaultNavigationTimeout(90_000);

  const contacts: { role: string; name: string; phone: string | null }[] = [];
  const seenIds = new Set<string>();
  const rollerPaths = new Set<string>();

  try {
    for (let pageNumber = 1; pageNumber <= 2; pageNumber++) {
      await page.goto(
        `https://www.regnskapstall.no/?query=${encodeURIComponent(company)}&page=${pageNumber}`,
        { waitUntil: "networkidle2" },
      );
      if (!(await page.$$eval("div.listing__body", (elements) => elements.length))) break;
      for (const path of await page.evaluate(() => {
        const paths = new Set<string>();
        for (const anchor of Array.from(
          document.querySelectorAll("div.listing__body a[href], p.listing__rel a[href]"),
        )) {
          let pathname = "";
          try {
            pathname = new URL(anchor.getAttribute("href") || "", "https://www.regnskapstall.no")
              .pathname;
          } catch {
            pathname = (anchor.getAttribute("href") || "").split("?")[0];
          }
          if (pathname.includes("/roller-og-eiere")) paths.add(pathname);
          else if (pathname.startsWith("/informasjon-om-")) {
            const slug = pathname.slice("/informasjon-om-".length);
            if (slug) paths.add(`/roller-og-eiere-av-${slug}`);
          }
        }
        return [...paths];
      })) rollerPaths.add(path);
    }

    const companyWords = company.toLowerCase().split(/\s+/).filter((word) => word.length > 1);
    for (const path of [...rollerPaths]
      .sort(
        (pathA, pathB) =>
          companyWords.reduce(
            (count, word) => count + (pathB.toLowerCase().includes(word) ? 1 : 0),
            0,
          ) -
            companyWords.reduce(
              (count, word) => count + (pathA.toLowerCase().includes(word) ? 1 : 0),
              0,
            ) || pathA.localeCompare(pathB),
      )
      .slice(0, 1)) {
      const rollerUrl = `https://www.regnskapstall.no${path}`;
      await page.goto(rollerUrl, { waitUntil: "networkidle2" });
      await page
        .evaluate(() => {
          const acceptButton = Array.from(document.querySelectorAll("button")).find((button) =>
            /accept|godta|agree|alle/i.test(button.textContent || ""),
          );
          if (acceptButton) acceptButton.click();
        })
        .catch(() => {});
      await page
        .waitForSelector("div.panel-body table.table-infopage tbody tr", { timeout: 30_000 })
        .catch(() => {});

      const rows = await page.$$eval("div.panel-body table.table-infopage tbody tr", (tableRows) =>
        tableRows
          .map((row) => {
            const cells = row.querySelectorAll("td");
            if (cells.length < 2) return null;
            return {
              role: (cells[0].textContent || "").trim(),
              links: Array.from(cells[1].querySelectorAll("a[href]")).map((anchor) => ({
                href: anchor.getAttribute("href") || "",
                text: (anchor.textContent || "").trim(),
              })),
            };
          })
          .filter(Boolean),
      );

      for (const row of rows as { role: string; links: { href: string; text: string }[] }[]) {
        for (const link of row.links) {
          const href = link.href.split("?")[0];
          let personKey = "";
          let searchTerms = "";
          const rollerMatch = href.match(/^\/roller-(.+)_(\d+)$/i);
          if (rollerMatch) {
            personKey = `${rollerMatch[1]}_${rollerMatch[2]}`;
            searchTerms = rollerMatch[1].replace(/-/g, " ");
          } else if (href.startsWith("/informasjon-om-")) {
            const slug = href.replace(/^\/informasjon-om-/, "");
            const orgNumber = (slug.match(/(\d+)([A-Z]\d+)?$/i) || [])[0] || "";
            personKey = orgNumber || slug.toLowerCase();
            searchTerms = (orgNumber ? slug.slice(0, -(orgNumber.length + 1)) : slug)
              .replace(/-/g, " ")
              .trim();
          } else continue;
          const personId = `${rollerUrl}|${personKey}|${href}`;
          if (seenIds.has(personId)) continue;
          seenIds.add(personId);

          const personName = link.text
            ? link.text.replace(/\s*\(f\s*\d{4}\)\s*$/i, "").trim()
            : searchTerms
                .split(/\s+/)
                .map((word) =>
                  word.length <= 2 && word === word.toLowerCase()
                    ? word.toUpperCase()
                    : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
                )
                .join(" ");

          await page.goto(`https://www.1881.no/?query=${encodeURIComponent(searchTerms)}`, {
            waitUntil: "networkidle2",
          });
          await page
            .waitForSelector(".listing__main, a[href*='/person/']", { timeout: 45_000 })
            .catch(() => {});

          const personHref = await page.evaluate((key) => {
            const matchingLinks = Array.from(document.querySelectorAll("a[href]")).filter(
              (anchor) => {
                const linkHref = anchor.getAttribute("href") || "";
                return linkHref.includes(key) && !/vCard|\.vcf/i.test(linkHref);
              },
            );
            const personLink =
              matchingLinks.find((anchor) =>
                /\/person\//i.test(anchor.getAttribute("href") || ""),
              ) || matchingLinks[0];
            return personLink?.getAttribute("href") || null;
          }, personKey);

          if (!personHref || /vCard|\.vcf/i.test(personHref)) {
            contacts.push({ role: row.role, name: personName, phone: null });
            continue;
          }

          const detailUrl = personHref.startsWith("http")
            ? personHref
            : `https://www.1881.no${personHref.startsWith("/") ? personHref : `/${personHref}`}`;
          await page.goto(detailUrl, { waitUntil: "networkidle2" }).catch(() =>
            page.goto(detailUrl, { waitUntil: "domcontentloaded" }),
          );

          const phone = await page.evaluate(() => {
            const phoneLink = document.querySelector('a[href^="tel:"]');
            if (!phoneLink) return null;
            const phoneSpan = phoneLink.querySelector(".listing-main-buttons__phone-number");
            return (
              phoneSpan?.textContent?.trim() ||
              (phoneLink.getAttribute("href") || "").replace(/^tel:/i, "").replace(/\D/g, "") ||
              null
            );
          });
          contacts.push({
            role: row.role,
            name: personName,
            phone: phone ? String(phone) : null,
          });
        }
      }
    }
    return contacts;
  } finally {
    await browser.close();
  }
}
