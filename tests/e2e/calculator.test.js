// index.html — калькулятор баллов против школьной таблицы
// «Тест Кальк. бал. WU test_new 2025.xlsx» (листы Лист2 и Data2).
const test = require("node:test");
const assert = require("node:assert/strict");
const { startBrowser } = require("./browser");
const { prepare, addElement } = require("./calc_helpers");

let browser;
test.before(async () => { browser = await startBrowser(); });
test.after(async () => { await browser.close(); });

async function openCalc() {
  const page = await browser.newPage();
  await page.open(browser.base, "index.html");
  await prepare(page);
  return page;
}

async function total(page) {
  await page.eval(`[...document.querySelectorAll("button")].find(b => b.textContent.startsWith("Расшифровка баллов")).click(); true`);
  return page.waitFor(`(() => {
    const s = [...document.querySelectorAll("span")].find(x => x.textContent === "ИТОГО");
    return s && s.nextElementSibling.textContent;
  })()`);
}

test("пример школьной таблицы (Лист2): SPIRIT 2, мортира + подъём переворотом = 8 баллов", async () => {
  const page = await openCalc();
  await page.eval(`__t.click("S2"); true`);
  await addElement(page, 0, "Лач-гейнер/Мортира Вис"); // 4 балла, динамика
  await addElement(page, 0, "Подъем переворотом Бл"); // 2 балла, статика
  // Data2: D16+E16 = 2+4 засчитано в [1; 4,5], баланс H16 при 1 статике и 1 динамике = 2 (уровень)
  assert.equal(await total(page), "8.00");
});

test("элементы своего разряда: в SPIRIT 5 считаются элементы на 5 и на 5,5 балла (Data2!D9)", async () => {
  const page = await openCalc();
  await page.eval(`__t.click("S5"); true`);
  await addElement(page, 0, "Солнышко Бл"); // 5 баллов
  await addElement(page, 0, "540 на махе вперёд Бл"); // 5,5 балла
  const badge = await page.eval(`[...document.querySelectorAll("div")].map(d => d.textContent).find(t => /^[✓✗] Эл\\. 5 разр\\./.test(t))`);
  assert.equal(badge, "✗ Эл. 5 разр.: 2/10+");
});
