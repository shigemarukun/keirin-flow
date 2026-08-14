import { ROLE } from './race-plan.js';

export class LineManager {
  constructor(setup) { this.applySetup(setup); }

  applySetup(setup) {
    this.setup = setup;
    this.lines = new Map();
    this.contextByNumber = new Map();

    for (const line of setup.lines) {
      const isSolo = line.members.length === 1;
      this.lines.set(line.id, { ...line, members: [...line.members], isSolo });
      line.members.forEach((number, index) => {
        let role = ROLE.LINE_MEMBER;
        if (isSolo) role = ROLE.SOLO;
        else if (index === 0) role = ROLE.LEADER;
        else if (index === 1) role = ROLE.BANTE;
        else if (index === 2) role = ROLE.THIRD;

        this.contextByNumber.set(number, {
          lineId: isSolo ? null : line.id,
          sourceLineId: line.id,
          linePosition: isSolo ? null : index,
          role,
          leaderNumber: isSolo ? null : line.leader,
          frontLineMate: !isSolo && index > 0 ? line.members[index - 1] : null,
          rearLineMate: !isSolo && index < line.members.length - 1 ? line.members[index + 1] : null
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
  activeLineIds() { return this.linesArray().filter(line=>!line.isSolo).map(line=>line.id); }
  soloNumbers() { return [...this.contextByNumber.entries()].filter(([,ctx])=>ctx.role===ROLE.SOLO).map(([n])=>n); }
  tailNumber(lineId) { const members=this.members(lineId); return members.length ? members[members.length-1] : null; }
}
