export const DEFAULT_RACE_PLAN = Object.freeze({
    1:{role:'TSUPPARI',topSpeed:22.8,acceleration:4.10,endurance:1.18,formation:10.5,defend1:20.0,defend2:20.5,final:20.0},
    2:{role:'BANTE',topSpeed:22.6,acceleration:4.00,endurance:1.16,final:20.2,blockLaneRate:0.96,blockTargetLane:28},
    3:{role:'THIRD',topSpeed:21.5,acceleration:3.55,endurance:1.04,final:18.9},
    4:{role:'MIDDLE_MAKURI',topSpeed:24.8,acceleration:4.65,endurance:1.14,makuri:24.0,blocked:13.0,overtakeLookahead:30,overtakeSpeedDelta:2.2,laneSearchMin:-12,laneSearchMax:46,laneSearchStep:6},
    5:{role:'BLOCK_DIVE',topSpeed:26.0,acceleration:5.10,endurance:1.18,dive:25.6,diveReaction:0.27,diveFeintLane:18},
    6:{role:'THIRD',topSpeed:22.2,acceleration:3.85,endurance:1.10,final:20.0},
    7:{role:'DOUBLE_ATTACK',topSpeed:25.0,acceleration:5.00,endurance:0.88,attack1:22.8,contest1:21.2,retreat:6.5,resetSpeed:15.0,attack2:24.6,contest2:23.2,fade:11.6,fadeLane:42,fadeBrake:3.15,retreatBrake:4.2,secondAttackLoad:2.30,collapseWithLeader:true},
    8:{role:'MARK',topSpeed:21.0,acceleration:3.60,endurance:0.88,final:14.8,fadeLane:44,secondAttackLoad:2.05,collapseWithLeader:true},
    9:{role:'MARK',topSpeed:21.7,acceleration:3.80,endurance:0.92,final:16.2,fadeLane:46,secondAttackLoad:1.95,collapseWithLeader:true}
});
