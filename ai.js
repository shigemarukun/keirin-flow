export class AIModel {
    constructor() {
        this.defaultLineGroups = [
            [1, 7, 3],
            [2, 5],
            [4, 9, 6],
            [8]
        ];
    }

    getInitialLineGroups() {
        return this.defaultLineGroups.map(group => [...group]);
    }
}
