export class AIModel {
    constructor() {
        this.defaultLineGroups = [
            [1, 2, 3],
            [4, 5, 6],
            [7, 8, 9]
        ];
    }

    getInitialLineGroups() {
        return this.defaultLineGroups.map(group => [...group]);
    }
}
