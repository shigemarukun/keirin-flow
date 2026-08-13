import { ROLE } from './race-plan.js';

export class LineManager {
  constructor(setup) { this.applySetup(setup); }

  applySetup(setup) {
    this.setup = setup;
    this.lines = new Map();
    this.contextByNumber = new Map();

    for (const line of setup.lines) {
      this.lines.set(line.id, { ...line, members: [...line.members] });
      line.members.forEach((number, index) => {
        let role = ROLE.LINE_MEMBER;
        if (index === 0) role = ROLE.LEADER;
        else if (index === 1) role = ROLE.BANTE;
        else if (index === 2) role = ROLE.THIRD;

        this.contextByNumber.set(number, {
          lineId: line.id,
          linePosition: index,
          role,
          leaderNumber: line.leader,
          frontLineMate: index > 0 ? line.members[index - 1] : null,
          rearLineMate: index < line.members.length - 1 ? line.members[index + 1] : null
        });
      });
    }

    for (const [numberText, profile] of Object.entries(setup.riders)) {
      const number = Number(numberText);
      if (profile.solo || !this.contextByNumber.has(number)) {
        this.contextByNumber.set(number, {
          lineId: null,
          linePosition: null,
          role: ROLE.SOLO,
          leaderNumber: null,
          frontLineMate: null,
          rearLineMate: null
        });
      }
    }
  }

  context(number) { return this.contextByNumber.get(number); }
  line(lineId) { return lineId == null ? null : this.lines.get(lineId) ?? null; }
  leaderNumber(lineId) { return this.line(lineId)?.leader ?? null; }
  members(lineId) { return this.line(lineId)?.members ?? []; }
  lineOf(number) { const ctx=this.context(number); return ctx?.lineId ? this.line(ctx.lineId) : null; }
  linesArray() { return [...this.lines.values()].map(line=>({...line,members:[...line.members]})); }
}
