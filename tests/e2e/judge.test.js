// judge.html — судейский калькулятор с авто-выбором разряда.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startBrowser } = require("./browser");
const { prepare, addElement, selectAthlete, results } = require("./calc_helpers");

let browser;
test.before(async () => { browser = await startBrowser(); });
test.after(async () => { await browser.close(); });

test("ДСК уходит в протокол с заявленным разрядом спортсмена, а не FREESTYLE 10", async () => {
  const page = await browser.newPage();
  await page.open(browser.base, "judge.html", {
    comp_athletes: [{ id: "s3", group: "Г1", name: "Сидоров Семён", sex: "м", age: 12, level: "SPIRIT 3", dir: "freestyle", present: true }],
  });
  await prepare(page);
  await selectAthlete(page, "s3");
  await addElement(page, 0, "Подъем переворотом Бл");
  await page.eval(`(() => {
    const row = [...document.querySelectorAll("div")].find(d => d.firstElementChild && d.firstElementChild.firstElementChild
      && d.firstElementChild.firstElementChild.textContent === "Дисквалификация");
    row.querySelector("button").click();
    return true;
  })()`);
  await page.waitFor(`document.body.innerText.includes("ДИСКВАЛИФИКАЦИЯ")`);
  await page.eval(`__t.click("В протокол"); true`);
  await page.waitFor(`JSON.parse(localStorage.getItem("comp_freestyle_results") || "[]").length === 1`);
  const [saved] = await results(page);
  assert.equal(saved.dsk, true);
  assert.equal(saved.total, 0);
  assert.equal(saved.level, "SPIRIT 3");
});
