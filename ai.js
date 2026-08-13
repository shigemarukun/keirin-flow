import { DEFAULT_RACE_SETUP, normalizeRaceSetup } from './race-plan.js';
export class AIModel{
 constructor(setup=DEFAULT_RACE_SETUP){this.setup=normalizeRaceSetup(setup);}
 getInitialRaceSetup(){return structuredClone(this.setup);}
 getInitialLineGroups(){return this.setup.lines.map(line=>[...line.members]);}
}
