import { test as base, expect } from '@playwright/test'


const test = base.extend({
  page: async ({ page, request }, use) => {
    const reset = await request.get('/__fixture/reset')
    expect(reset.ok()).toBe(true)
    await use(page)
  },
})


export { test, expect }
