// competition.html — протокол разрядных соревнований.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startBrowser, DOM } = require("./browser");
const { prepare, addElement, selectAthlete, results } = require("./calc_helpers");

let browser;
test.before(async () => { browser = await startBrowser(); });
test.after(async () => { await browser.close(); });

const athlete = (id, name, extra = {}) => ({ id, group: "Г1", name, sex: "м", age: 12, level: "SPIRIT 2", dir: "freestyle", present: true, ...extra });
const result = (idx, a, total, extra = {}) => ({
  athleteIdx: idx, id: a.id, group: a.group, name: a.name, sex: a.sex, age: a.age, level: a.level,
  statika: total, dynamika: 0, combo: 0, universality: 0, creative: 0, dirty: 0, fall: 0, dsk: false,
  comboCheck: true, minElCheck: true, penalties: 0, total, passed: true, ...extra,
});
const A = athlete("a1", "Аверин Антон");
const B = athlete("b2", "Борисов Борис");
const C = athlete("c3", "Власов Виктор");
const D = athlete("d4", "Гусев Глеб");

async function openProtocol(storage) {
  const page = await browser.newPage();
  await page.open(browser.base, "competition.html", storage);
  await page.eval(DOM);
  return page;
}

async function tab(page, name) {
  await page.eval(`[...document.querySelectorAll(".tabs button")].find(b => b.textContent === ${JSON.stringify(name)}).click(); true`);
}

// Судейство: выбрать спортсмена по имени, поставить статику и сохранить.
async function judgeFreestyle(page, name, statika) {
  await tab(page, "Судейство");
  await page.waitFor(`[...document.querySelectorAll("option")].some(o => o.textContent.includes(${JSON.stringify(name)}))`);
  await page.eval(`(() => {
    const opt = [...document.querySelectorAll("option")].find(o => o.textContent.includes(${JSON.stringify(name)}));
    __t.setValue(opt.parentElement, opt.value);
    return true;
  })()`);
  await page.waitFor(`[...document.querySelectorAll("label")].some(l => l.textContent === "Статика")`);
  await page.eval(`(() => {
    const input = [...document.querySelectorAll("label")].find(l => l.textContent === "Статика").parentElement.querySelector("input");
    __t.setValue(input, ${JSON.stringify(String(statika))});
    return true;
  })()`);
  await page.waitFor(`document.querySelector(".score-big") && document.querySelector(".score-big").textContent === ${JSON.stringify(statika.toFixed(1))}`);
  await page.eval(`__t.click("Сохранить в протокол"); true`);
  await page.waitFor(`document.body.innerText.includes("Результат сохранён")`);
}

test("удаление участника не переносит чужой результат: после повторного судейства результат Борисова цел", async () => {
  const page = await openProtocol({
    comp_athletes: [A, B, C],
    comp_freestyle_results: [result(1, B, 30), result(2, C, 20)],
  });
  // Удаляем Аверина (первая строка) — индексы Борисова и Власова сдвигаются.
  await page.eval(`(() => {
    const row = [...document.querySelectorAll("tr")].find(tr => tr.textContent.includes("Аверин Антон"));
    [...row.querySelectorAll("button")].find(b => b.textContent === "×").click();
    return true;
  })()`);
  await page.waitFor(`!document.body.innerText.includes("Аверин Антон")`);
  await judgeFreestyle(page, "Власов Виктор", 25);
  const saved = await results(page);
  assert.deepEqual(saved.filter(r => r.id === "b2").map(r => r.total), [30], "результат Борисова не должен пропасть");
  assert.deepEqual(saved.filter(r => r.id === "c3").map(r => r.total), [25], "у Власова ровно один, новый результат");
});

test("фристайлер с уровнем не из фристайла не роняет страницу при судействе", async () => {
  const page = await openProtocol({ comp_athletes: [athlete("x9", "Хромов Харитон", { level: "BASE 3" })] });
  await tab(page, "Судейство");
  await page.eval(`(() => {
    const opt = [...document.querySelectorAll("option")].find(o => o.textContent.includes("Хромов"));
    __t.setValue(opt.parentElement, opt.value);
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 500));
  assert.ok(await page.eval(`!!document.querySelector(".tabs")`), "страница не должна опустеть");
  const text = await page.eval(`document.body.innerText`);
  assert.match(text, /BASE 3/);
  assert.match(text, /не найден/);
});

test("результат из калькулятора в соседней вкладке не затирается сохранением в протоколе", async () => {
  const protocol = await openProtocol({ comp_athletes: [A, B] });
  const calc = await browser.newPage();
  await calc.goto(browser.base + "/index.html"); // та же вкладка-браузер, общий localStorage
  await calc.waitFor(`document.getElementById("root").children.length > 0`);
  await prepare(calc);
  await selectAthlete(calc, "a1");
  await addElement(calc, 0, "Подъем переворотом Бл");
  await calc.eval(`__t.click("🏆 В протокол"); true`);
  await calc.waitFor(`JSON.parse(localStorage.getItem("comp_freestyle_results") || "[]").some(r => r.id === "a1")`);
  // Протокол был открыт раньше и про результат Аверина не знает; судим Борисова.
  await judgeFreestyle(protocol, "Борисов Борис", 10);
  const saved = await results(protocol);
  assert.ok(saved.some(r => r.id === "a1"), "результат Аверина из калькулятора не должен пропасть");
  assert.ok(saved.some(r => r.id === "b2"), "результат Борисова сохранён");
});

test("дисквалифицированный не попадает в призёры", async () => {
  const page = await openProtocol({
    comp_athletes: [A, B, C, D],
    comp_freestyle_results: [result(0, A, 90, { dsk: true, passed: false }), result(1, B, 50), result(2, C, 40), result(3, D, 30)],
  });
  await tab(page, "Призёры");
  await page.waitFor(`document.body.innerText.includes("Борисов Борис")`);
  const text = await page.eval(`document.body.innerText`);
  assert.doesNotMatch(text, /Аверин Антон/, "ДСК не в призах");
  assert.match(text, /Гусев Глеб/, "третье место — следующий по баллам");
});
