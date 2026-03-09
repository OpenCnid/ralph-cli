# Drift Report — Fix Descriptions

Generated: 2026-03-08T08:23:15.344Z

- [ ] **src/commands/ci/index.ts**: Uses console.log instead of structured logging (1 occurrence, line 132)
  Fix: Replace console calls with a structured logger or remove debug logging

- [ ] **src/commands/doctor/index.ts**: Uses console.log instead of structured logging (7 occurrences, lines 524, 552, 560, 567, 573, 580, 593)
  Fix: Replace console calls with a structured logger or remove debug logging

- [ ] **src/commands/gc/index.ts**: Uses console.log instead of structured logging (7 occurrences, lines 609, 677, 705, 711, 712, 715, 722)
  Fix: Replace console calls with a structured logger or remove debug logging

- [ ] **src/commands/grade/index.ts**: Uses console.log instead of structured logging (13 occurrences, lines 698, 700, 709, 716, 719, 774, 776, 777, 778, 779, 780, 787, 802)
  Fix: Replace console calls with a structured logger or remove debug logging

- [ ] **src/commands/init/index.ts**: Uses console.log instead of structured logging (1 occurrence, line 77)
  Fix: Replace console calls with a structured logger or remove debug logging

- [ ] **src/commands/lint/index.ts**: Uses console.log instead of structured logging (9 occurrences, lines 87, 94, 100, 101, 103, 119, 125, 126, 128)
  Fix: Replace console calls with a structured logger or remove debug logging

- [ ] **src/commands/plan/index.ts**: Uses console.log instead of structured logging (12 occurrences, lines 374, 382, 386, 389, 393, 397, 401, 414, 424, 434, 440, 441)
  Fix: Replace console calls with a structured logger or remove debug logging

- [ ] **src/commands/promote/index.ts**: Uses console.log instead of structured logging (8 occurrences, lines 170, 182, 183, 184, 196, 209, 219, 225)
  Fix: Replace console calls with a structured logger or remove debug logging

- [ ] **src/commands/ref/index.ts**: Uses console.log instead of structured logging (9 occurrences, lines 115, 122, 124, 125, 128, 129, 297, 299, 301)
  Fix: Replace console calls with a structured logger or remove debug logging

- [ ] **src/config/loader.ts**: Deep optional chaining (architecture?.rules?.naming?.schemas) suggests unvalidated data probing (2 occurrences, lines 78, 79)
  Fix: Validate data shape at the boundary using schema validation instead of deep probing

- [ ] **src/utils/output.ts**: Uses console.log instead of structured logging (5 occurrences, lines 4, 8, 12, 16, 20)
  Fix: Replace console calls with a structured logger or remove debug logging

- [ ] **vitest.config.ts**: File exports symbols but is not imported by any other file (last referenced in commit 06b8fcd, 2026-03-08)
  Fix: Delete vitest.config.ts if no longer needed, or document why it is retained

- [ ] **src/commands/ci/ci.test.ts**: Test file with no corresponding source file: src/commands/ci/ci.ts
  Fix: Remove src/commands/ci/ci.test.ts or create the corresponding source file src/commands/ci/ci.ts

- [ ] **src/commands/doctor/doctor.test.ts**: Test file with no corresponding source file: src/commands/doctor/doctor.ts
  Fix: Remove src/commands/doctor/doctor.test.ts or create the corresponding source file src/commands/doctor/doctor.ts

- [ ] **src/commands/gc/gc.test.ts**: Test file with no corresponding source file: src/commands/gc/gc.ts
  Fix: Remove src/commands/gc/gc.test.ts or create the corresponding source file src/commands/gc/gc.ts

- [ ] **src/commands/grade/grade.test.ts**: Test file with no corresponding source file: src/commands/grade/grade.ts
  Fix: Remove src/commands/grade/grade.test.ts or create the corresponding source file src/commands/grade/grade.ts

- [ ] **src/commands/hooks/hooks.test.ts**: Test file with no corresponding source file: src/commands/hooks/hooks.ts
  Fix: Remove src/commands/hooks/hooks.test.ts or create the corresponding source file src/commands/hooks/hooks.ts

- [ ] **src/commands/init/init.test.ts**: Test file with no corresponding source file: src/commands/init/init.ts
  Fix: Remove src/commands/init/init.test.ts or create the corresponding source file src/commands/init/init.ts

- [ ] **src/commands/lint/lint.test.ts**: Test file with no corresponding source file: src/commands/lint/lint.ts
  Fix: Remove src/commands/lint/lint.test.ts or create the corresponding source file src/commands/lint/lint.ts

- [ ] **src/commands/plan/plan.test.ts**: Test file with no corresponding source file: src/commands/plan/plan.ts
  Fix: Remove src/commands/plan/plan.test.ts or create the corresponding source file src/commands/plan/plan.ts

- [ ] **src/commands/promote/promote.test.ts**: Test file with no corresponding source file: src/commands/promote/promote.ts
  Fix: Remove src/commands/promote/promote.test.ts or create the corresponding source file src/commands/promote/promote.ts

- [ ] **src/commands/ref/ref.test.ts**: Test file with no corresponding source file: src/commands/ref/ref.ts
  Fix: Remove src/commands/ref/ref.test.ts or create the corresponding source file src/commands/ref/ref.ts

