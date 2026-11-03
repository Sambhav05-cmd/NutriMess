import { scoreStrategy } from './active-planner.js';
import { micros, portionStep } from './nutrition.js';

// Plan: current score minus score without this food in this meal.
// Editor: score after the next portion step minus the current score.
export function foodImpacts(strategy, foods, target, profile, state, requests, mode='contribution') {
  const base=scoreStrategy(strategy,foods,target,profile,state);
  const value=objective=>100/(1+Math.max(0,-objective)/(49+1.5*micros.length));
  const currentScore=base.experimental?base.value:value(base.objectiveScore);
  const impacts=requests.map(({day,meal,foodId})=>{
    const entries=strategy.days[day].entries;
    const portions=entries.filter(e=>e.meal===meal&&e.foodId===foodId).reduce((sum,e)=>sum+e.portions,0);
    const step=portionStep(foods.get(foodId)),addition=mode==='addition';
    const changedEntries=entries.filter(e=>e.meal!==meal||e.foodId!==foodId);
    if(addition)changedEntries.push({foodId,meal,portions:portions+step});
    const changed={...strategy,days:strategy.days.map((d,i)=>i===day?{...d,entries:changedEntries}:d)};
    const comparison=!addition&&!portions?base:scoreStrategy(changed,foods,target,profile,state);
    const comparisonScore=base.experimental?comparison.value:value(comparison.objectiveScore);
    const objectiveDelta=addition?comparison.objectiveScore-base.objectiveScore:base.objectiveScore-comparison.objectiveScore;
    // Gaussian products may underflow; their log differences preserve direction.
    const delta=base.experimental?objectiveDelta:addition?comparisonScore-currentScore:currentScore-comparisonScore;
    const band=delta< -1?0:delta< -.05?1:delta<0?2:delta<.05?3:delta<1?4:5;
    return {day,meal,foodId,mode,portions,step,currentScore,comparisonScore,
      scale:base.experimental?'log-score':'points',currentLogScore:base.logScore,comparisonLogScore:comparison.logScore,
      ...(addition?{nextScore:comparisonScore,nextPortions:portions+step}:{withoutFoodScore:comparisonScore}),
      delta,band,objectiveDelta};
  });
  return {score:base,mode,impacts};
}
