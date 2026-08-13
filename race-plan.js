export const DEFAULT_RACE_PLAN = Object.freeze({
    1:{role:'TSUPPARI',topSpeed:22.8,acceleration:4.10,endurance:1.05,formation:10.5,defend1:20.0,defend2:20.5,final:19.4,leadLoadMultiplier:2.15,defendLoadMultiplier:2.65,finalFadeEnergy:0.34,finalFadeRemaining:58,finalFadeSpeed:14.8,finalFadeBrake:4.6},
    2:{role:'BANTE',topSpeed:23.4,acceleration:4.25,endurance:1.18,final:22.4,finalKick:24.2,leaderReleaseEnergy:0.38,blockLaneRate:0.96,blockTargetLane:28},
    3:{role:'THIRD',topSpeed:21.5,acceleration:3.55,endurance:1.04,final:18.9},
    4:{role:'MIDDLE_MAKURI',topSpeed:28.2,acceleration:5.85,endurance:1.18,makuri:27.2,blocked:15.2,postBlockKick:26.4,blockRecoveryFactor:0.88,overtakeLookahead:34,overtakeSpeedDelta:1.8,laneSearchMin:-12,laneSearchMax:46,laneSearchStep:6},
    5:{role:'BLOCK_DIVE',topSpeed:27.0,acceleration:5.30,endurance:1.20,dive:26.2,diveReaction:0.27,diveFeintLane:18},
    6:{role:'THIRD',topSpeed:23.0,acceleration:4.05,endurance:1.12,final:21.2},
    7:{role:'DOUBLE_ATTACK',topSpeed:25.0,acceleration:5.00,endurance:0.88,attack1:22.8,contest1:21.2,retreat:6.5,resetSpeed:15.0,attack2:24.6,contest2:23.2,fade:11.6,fadeLane:42,fadeBrake:3.15,retreatBrake:4.2,secondAttackLoad:2.30,collapseWithLeader:true},
    8:{role:'MARK',topSpeed:21.0,acceleration:3.60,endurance:0.88,final:14.8,fadeLane:44,secondAttackLoad:2.05,collapseWithLeader:true},
    9:{role:'MARK',topSpeed:21.7,acceleration:3.80,endurance:0.92,final:16.2,fadeLane:46,secondAttackLoad:1.95,collapseWithLeader:true}
});
