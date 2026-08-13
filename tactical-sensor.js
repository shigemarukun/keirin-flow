export class TacticalSensor {
  sense(rider, engine) {
    const frontRider = engine.findNearestAhead(rider);
    const rearRider = engine.findNearestBehind(rider);
    const context = engine.lineManager.context(rider.number);
    const lineLeader = context?.leaderNumber ? engine.rider(context.leaderNumber) : null;
    const nearestAttacker = engine.findNearestAttacker(rider);

    return {
      remainingDistance: engine.raceClock.remainingDistance,
      energy: rider.energy,
      speed: rider.speed,
      laneOffset: rider.laneOffset,
      frontRider,
      rearRider,
      lineLeader,
      context,
      nearestAttacker,
      pressureFromOutside: engine.measureOutsidePressure(rider),
      insideDensity: engine.laneDensityAround(rider, rider.laneOffset - 12),
      currentDensity: engine.laneDensityAround(rider, rider.laneOffset),
      outsideDensity: engine.laneDensityAround(rider, rider.laneOffset + 12),
      frontSpeedDelta: frontRider ? frontRider.speed - rider.speed : 0,
      lineIntegrity: engine.measureLineIntegrity(context?.lineId),
      positionRank: engine.positionRank(rider),
      leaderGap: lineLeader ? lineLeader.distance - rider.distance : null
    };
  }
}
