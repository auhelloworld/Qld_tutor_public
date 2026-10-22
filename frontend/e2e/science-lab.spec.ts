import { expect, test, type Locator, type Page } from '@playwright/test';

const ACTIVITIES = [
  ['SCI-SEASONS-01', 'Earth, Sun and the Seasons'],
  ['SCI-PARTICLE-01', 'Particle Model: States, Expansion & Diffusion'],
  ['SCI-FORCE-01', 'Force, Friction and Newton’s Laws'],
  ['SCI-FOODWEB-01', 'Food Web Ecosystem Dynamics'],
  ['SCI-WAVE-01', 'Waves: Transverse, Longitudinal & Medium'],
  ['SCI-SELECTION-01', 'Natural Selection Across Generations'],
  ['SCI-ENERGY-01', 'Energy & Efficiency Workbench'],
  ['SCI-SEPARATION-01', 'Separation Process Designer'],
  ['SCI-REACTION-BALANCE-01', 'Closed-System Reaction Balancer'],
  ['SCI-PLATES-01', 'Plate Boundary & Evidence Engine'],
  ['SCI-HOMEOSTASIS-01', 'Homeostasis Controller'],
  ['SCI-MEASUREMENT-01', 'Measurement, Graph & Error Studio'],
  ['SCI-GENETICS-01', 'Chromosome-to-Offspring Lab'],
  ['SCI-REACTION-RATE-01', 'Collision & Reaction Rate Lab'],
  ['SCI-CARBON-CLIMATE-01', 'Earth-System Carbon & Climate Lab'],
  ['SCI-HALF-LIFE-01', 'Seeded Decay & Half-Life Lab'],
  ['SCI-MOON-TIDES-01', 'Moon–Tide–Eclipse Lab'],
  ['SCI-CELL-SYSTEM-01', 'Cell-to-System Failure Lab'],
] as const;

const SCIENCE_COMPLETION_STORAGE_PREFIX = 'qld-science-lab-completed-v1:';

function monitorRuntimeErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function continueWithoutSigningIn(page: Page): Promise<void> {
  const continueButton = page.getByRole('button', { name: 'Continue on this browser' });
  try {
    await continueButton.waitFor({ state: 'visible', timeout: 2_000 });
    await continueButton.click();
  } catch {
    // The browser-only profile was already accepted during this test.
  }
}

async function openExploreActivity(
  page: Page,
  activityId: (typeof ACTIVITIES)[number][0],
): Promise<void> {
  const activity = ACTIVITIES.find(([id]) => id === activityId);
  if (!activity) throw new Error(`Unknown Science Lab activity: ${activityId}`);

  await page.goto(`/science-lab?activity=${encodeURIComponent(activityId)}&mode=explore`);
  await continueWithoutSigningIn(page);
  await expect(page.getByRole('heading', { level: 1, name: activity[1] })).toBeVisible();
  await expect(page.getByRole('button', { name: /Explore Sandbox/ })).toHaveAttribute('aria-pressed', 'true');
}

async function dragFromHandle(
  page: Page,
  svg: Locator,
  handle: Locator,
  destination: { xRatio: number; yRatio: number },
): Promise<void> {
  const [svgBox, handleBox] = await Promise.all([svg.boundingBox(), handle.boundingBox()]);
  if (!svgBox || !handleBox) throw new Error('Expected visible SVG and science drag handle');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(30);
  await page.mouse.move(
    svgBox.x + svgBox.width * destination.xRatio,
    svgBox.y + svgBox.height * destination.yRatio,
    { steps: 5 },
  );
  await page.mouse.up();
}

async function dispatchVerticalTouchSwipe(page: Page, svg: Locator): Promise<void> {
  await svg.scrollIntoViewIfNeeded();
  const point = await svg.evaluate((element) => {
    const svgRect = element.getBoundingClientRect();
    const handle = element.querySelector('[data-science-drag-handle]');
    const handleRect = handle?.getBoundingClientRect();
    const candidates = [
      [0.88, 0.78],
      [0.12, 0.78],
      [0.88, 0.62],
      [0.12, 0.62],
    ] as const;

    for (const [xRatio, yRatio] of candidates) {
      const x = svgRect.left + svgRect.width * xRatio;
      const y = svgRect.top + svgRect.height * yRatio;
      const isInsideHandle = handleRect
        ? x >= handleRect.left - 8 && x <= handleRect.right + 8
          && y >= handleRect.top - 8 && y <= handleRect.bottom + 8
        : false;
      const hit = document.elementFromPoint(x, y);
      if (!isInsideHandle && hit instanceof Element && element.contains(hit)) return { x, y };
    }
    throw new Error('Could not find a non-drag point inside the SVG');
  });

  const initialScrollY = await page.evaluate(() => window.scrollY);
  const distance = 120;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: point.x, y: point.y, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
    });
    for (let step = 1; step <= 4; step += 1) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{
          x: point.x,
          y: point.y - (distance * step) / 4,
          id: 1,
          radiusX: 2,
          radiusY: 2,
          force: 1,
        }],
      });
      await page.waitForTimeout(30);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }

  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(initialScrollY + 20);
}

test('directory exposes all 18 activities and accessible filters', async ({ page }) => {
  const runtimeErrors = monitorRuntimeErrors(page);
  await page.goto('/science-lab');
  await continueWithoutSigningIn(page);

  await expect(page.getByRole('heading', { name: 'Interactive Science Lab' })).toBeVisible();
  await expect(page.getByText('18 labs match the selected filters.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Start Lab:/ })).toHaveCount(18);

  const year8 = page.getByRole('button', { name: 'Year 8' });
  await expect(year8).toHaveAttribute('aria-pressed', 'false');
  await year8.click();
  await expect(year8).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Energy & Efficiency Workbench' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Plate Boundary & Evidence Engine' })).toBeVisible();

  const inquiry = page.getByRole('button', { name: 'Science Inquiry' });
  await inquiry.click();
  await expect(page.getByRole('heading', { name: 'Measurement, Graph & Error Studio' })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('all registered activities load a real visual without runtime errors', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-chromium', 'All-scene smoke runs once on desktop Chromium.');

  const runtimeErrors = monitorRuntimeErrors(page);
  for (const [id, title] of ACTIVITIES) {
    await page.goto(`/science-lab?activity=${encodeURIComponent(id)}&mode=explore`);
    await continueWithoutSigningIn(page);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.locator('svg[role="img"], canvas[role="img"]').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Explore Sandbox/ })).toHaveAttribute('aria-pressed', 'true');
  }
  expect(runtimeErrors).toEqual([]);
});

test('Learn mode gates results and completes a local evidence notebook', async ({ page }) => {
  const runtimeErrors = monitorRuntimeErrors(page);
  await page.goto('/science-lab?activity=SCI-SEASONS-01&mode=learn&subject=science&year=7&topic=AC9S7U03');
  await continueWithoutSigningIn(page);

  await expect(page.getByRole('heading', { level: 1, name: 'Earth, Sun and the Seasons' })).toBeVisible();
  await expect(page.getByText(/Submit your prediction above to reveal quantitative live measurements/i)).toBeVisible();

  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: /Submit Prediction/i }).click();
  await expect(page.getByText(/Your prediction/i).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inquiry Notebook' })).toBeVisible();

  await page.getByLabel('Prediction reasoning').fill('I predict that changing Earth’s position changes the sunlight angle, and I will compare dates.');
  await page.getByLabel('Independent variable', { exact: true }).fill('Day of year');
  await page.getByLabel('Dependent variable', { exact: true }).fill('Solar altitude and daylight hours');
  await page.getByLabel('Controlled variables', { exact: true }).fill('Observer latitude and axial tilt');

  const stageButtons = page.getByRole('button', { name: /^Step [1-5]:/ });
  await expect(stageButtons).toHaveCount(5);
  for (let index = 0; index < 5; index += 1) await stageButtons.nth(index).click();

  const daySlider = page.getByRole('slider', { name: 'Day of year slider' });
  const record = page.getByRole('button', { name: 'Record current observation' });
  await daySlider.fill('1');
  await record.click();
  await daySlider.fill('80');
  await record.click();
  await daySlider.fill('172');
  await record.click();

  await page.getByText('3. Claim, evidence, reasoning and limitation').click();
  await page.getByLabel('CER claim').fill('Axial tilt and orbital position change the sunlight received at the observer location.');
  await page.getByLabel('CER evidence').fill('The three recorded dates produced different solar altitude and daylight values.');
  await page.getByLabel('CER reasoning').fill('More direct sunlight concentrates the same incoming energy over a smaller surface area.');
  await page.getByLabel('Model limitation').selectOption({ index: 1 });

  await expect(page.getByText('Investigation complete.')).toBeVisible();
  const savedCompletion = await page.evaluate((prefix) => {
    const studentId = window.localStorage.getItem('qld_tutor_student_id');
    if (!studentId) return null;
    const encodedStudentId = encodeURIComponent(studentId);
    const key = Object.keys(window.localStorage).find(
      (candidate) => candidate.startsWith(prefix) && candidate.includes(encodedStudentId),
    );
    return key ? { key, value: window.localStorage.getItem(key) } : null;
  }, SCIENCE_COMPLETION_STORAGE_PREFIX);
  expect(savedCompletion?.key).toContain(encodeURIComponent(
    await page.evaluate(() => window.localStorage.getItem('qld_tutor_student_id') ?? ''),
  ));
  expect(savedCompletion?.value).toContain('SCI-SEASONS-01');
  expect(runtimeErrors).toEqual([]);
});

test('P0 Force supports positive and negative force with synchronized readout', async ({ page }) => {
  const runtimeErrors = monitorRuntimeErrors(page);
  await openExploreActivity(page, 'SCI-FORCE-01');

  const pause = page.getByRole('button', { name: 'Pause simulation' });
  if (await pause.isVisible()) await pause.click();

  const force = page.getByRole('slider', { name: 'Applied force in Newtons' });
  const readout = page.getByText(/F_net = .*· a =/).first();
  const netForce = async () => {
    const text = await readout.textContent();
    const match = text?.match(/F_net =\s*([+-]?\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : Number.NaN;
  };

  await force.fill('40');
  await expect(force).toHaveValue('40');
  await expect.poll(netForce).toBeGreaterThan(0);

  await force.fill('-40');
  await expect(force).toHaveValue('-40');
  await expect.poll(netForce).toBeLessThan(0);
  expect(runtimeErrors).toEqual([]);
});

test('P0 Food Web keeps perturbation, playback and reset generation synchronized', async ({ page }) => {
  const runtimeErrors = monitorRuntimeErrors(page);
  await openExploreActivity(page, 'SCI-FOODWEB-01');

  const perturbation = page.getByRole('button', { name: /Remove Apex Predators/ });
  await perturbation.click();
  await expect(perturbation).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: /Australian Grassland Food Web \(Generation 0\)/ })).toBeVisible();

  await page.getByRole('button', { name: 'Play simulation' }).click();
  await expect.poll(async () => {
    const text = await page.getByRole('heading', { name: /Australian Grassland Food Web/ }).textContent();
    return Number(text?.match(/Generation (\d+)/)?.[1] ?? 0);
  }).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause simulation' }).click();

  await page.getByRole('button', { name: 'Reset simulation to initial state' }).click();
  await expect(page.getByRole('heading', { name: /Australian Grassland Food Web \(Generation 0\)/ })).toBeVisible();
  await expect(perturbation).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: /Balanced Grassland/ })).toHaveAttribute('aria-pressed', 'true');
  expect(runtimeErrors).toEqual([]);
});

test('P0 Particle and Wave expose play-pause plus vacuum mechanical and EM states', async ({ page }) => {
  const runtimeErrors = monitorRuntimeErrors(page);
  await openExploreActivity(page, 'SCI-PARTICLE-01');

  await page.getByRole('button', { name: 'Pause simulation' }).click();
  await expect(page.getByRole('button', { name: 'Play simulation' })).toBeVisible();
  await expect(page.getByText(/states mode.*Paused/i)).toBeVisible();
  await page.getByRole('button', { name: 'Play simulation' }).click();
  await expect(page.getByRole('button', { name: 'Pause simulation' })).toBeVisible();

  await openExploreActivity(page, 'SCI-WAVE-01');
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  await expect(page.getByRole('button', { name: 'Play simulation' })).toBeVisible();
  await expect(page.getByText(/material medium selected.*Paused.*outcome revealed/i)).toBeVisible();

  const vacuum = page.getByRole('button', { name: /Toggle medium presence for vacuum test/ });
  await vacuum.click();
  await expect(vacuum).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Vacuum: mechanical sound blocked; electromagnetic channel transmitted', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Sound Longitudinal' }).click();
  await expect(page.getByText('Vacuum: mechanical sound blocked', { exact: true })).toBeVisible();
  await expect(page.getByText(/Mechanical sound channel.*vacuum selected.*Paused.*outcome revealed/i)).toBeVisible();

  await page.getByRole('button', { name: 'EM Transverse' }).click();
  await expect(page.getByText('Electromagnetic channel: transmitted in vacuum', { exact: true })).toBeVisible();
  await expect(page.getByText(/Electromagnetic channel.*vacuum selected.*Paused.*outcome revealed/i)).toBeVisible();

  await page.getByRole('button', { name: 'Play simulation' }).click();
  await expect(page.getByRole('button', { name: 'Pause simulation' })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('P0 Selection synchronizes deterministic seed and generation controls', async ({ page }) => {
  const runtimeErrors = monitorRuntimeErrors(page);
  await openExploreActivity(page, 'SCI-SELECTION-01');

  const seed = page.getByRole('slider', { name: 'Simulation random seed' });
  await seed.fill('77');
  await expect(seed).toHaveValue('77');

  await page.getByRole('button', { name: /Run 10 Gens/ }).click();
  await expect(page.getByRole('heading', { name: 'Population Habitat (Generation 10)' })).toBeVisible();
  await expect(seed).toHaveValue('77');

  await page.getByRole('button', { name: 'Reset simulation to initial state' }).click();
  await expect(page.getByRole('heading', { name: 'Population Habitat (Generation 0)' })).toBeVisible();
  await expect(seed).toHaveValue('77');
  expect(runtimeErrors).toEqual([]);
});

test('P1 Seasons and Moon retain keyboard controls with dedicated drag surfaces', async ({ page }) => {
  const runtimeErrors = monitorRuntimeErrors(page);
  await openExploreActivity(page, 'SCI-SEASONS-01');

  const seasonsSvg = page.getByRole('img', { name: /Interactive top-down orbit/i });
  const earthHandle = seasonsSvg.locator('[data-science-drag-handle="earth"]');
  await expect(seasonsSvg).toHaveAttribute('tabindex', '0');
  await expect(earthHandle).toHaveCount(1);
  expect(await seasonsSvg.evaluate((element) => getComputedStyle(element).touchAction)).toBe('auto');
  expect(await earthHandle.evaluate((element) => getComputedStyle(element).touchAction)).toBe('none');

  const day = page.getByRole('slider', { name: 'Day of year slider' });
  await seasonsSvg.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(day).toHaveValue('354');
  await dragFromHandle(page, seasonsSvg, earthHandle, { xRatio: 0.85, yRatio: 0.5 });
  await expect(day).not.toHaveValue('354');

  await openExploreActivity(page, 'SCI-MOON-TIDES-01');
  const moonSvg = page.getByRole('img', { name: /Top view of the Sun, Earth and Moon/i });
  const moonHandle = moonSvg.locator('[data-science-drag-handle="moon"]');
  await expect(moonSvg).toHaveAttribute('tabindex', '0');
  await expect(moonHandle).toHaveCount(1);
  expect(await moonSvg.evaluate((element) => getComputedStyle(element).touchAction)).toBe('auto');
  expect(await moonHandle.evaluate((element) => getComputedStyle(element).touchAction)).toBe('none');

  const moonAngle = page.getByRole('slider', { name: 'Moon orbital angle in degrees' });
  const initialMoonAngle = await moonAngle.inputValue();
  await moonSvg.focus();
  await page.keyboard.press('ArrowRight');
  await expect(moonAngle).not.toHaveValue(initialMoonAngle);
  const keyboardMoonAngle = await moonAngle.inputValue();
  await dragFromHandle(page, moonSvg, moonHandle, { xRatio: 0.52, yRatio: 0.84 });
  await expect(moonAngle).not.toHaveValue(keyboardMoonAngle);
  expect(runtimeErrors).toEqual([]);
});

test('P1 mobile swipes scroll from non-drag Seasons and Moon SVG regions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Requires Chromium mobile touch emulation and CDP input.');

  const runtimeErrors = monitorRuntimeErrors(page);
  const activities = [
    ['SCI-SEASONS-01', /Interactive top-down orbit/i, 'earth', 'Day of year slider'],
    ['SCI-MOON-TIDES-01', /Top view of the Sun, Earth and Moon/i, 'moon', 'Moon orbital angle in degrees'],
  ] as const;

  for (const [activityId, accessibleName, handleName, sliderName] of activities) {
    await openExploreActivity(page, activityId);
    const svg = page.getByRole('img', { name: accessibleName });
    const handle = svg.locator(`[data-science-drag-handle="${handleName}"]`);
    const slider = page.getByRole('slider', { name: sliderName });

    await expect(handle).toHaveCount(1);
    expect(await svg.evaluate((element) => getComputedStyle(element).touchAction)).toBe('auto');
    expect(await handle.evaluate((element) => getComputedStyle(element).touchAction)).toBe('none');
    const valueBeforeSwipe = await slider.inputValue();
    await dispatchVerticalTouchSwipe(page, svg);
    await expect(slider).toHaveValue(valueBeforeSwipe);
  }

  expect(runtimeErrors).toEqual([]);
});

test('mobile layout keeps controls usable without document-level horizontal overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'Mobile-specific layout assertion.');

  const runtimeErrors = monitorRuntimeErrors(page);
  await page.goto('/science-lab?activity=SCI-ENERGY-01&mode=explore');
  await continueWithoutSigningIn(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Energy & Efficiency Workbench' })).toBeVisible();
  await expect(page.getByRole('slider').first()).toBeVisible();
  await expect(page.locator('svg[role="img"]').first()).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(runtimeErrors).toEqual([]);
});
