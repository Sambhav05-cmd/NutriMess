// Only reviewed food/form matches can share per-100g values. Raw grains are
// deliberately not aliases for cooked rice, idli or other prepared dishes.
const datasetMatches={Curd:'curd',Banana:'ifct-E012',Paneer:'ifct-L003'};

export function applyDatasetPriority(food,primary) {
  const candidate=primary.find(f=>f.id===datasetMatches[food.name]);
  const reference=candidate&&((candidate.id.startsWith('ifct-')&&candidate.source==='IFCT 2017')||/^USDA\b/.test(candidate.source))&&candidate.grams>0?candidate:null;
  const servingGrams=food.grams??100;
  const factor=reference?servingGrams/reference.grams:1;
  const nutrientSources={},values={...food.nutrients};
  for(const key of Object.keys(values)){
    if(reference&&Number.isFinite(reference.nutrients[key])){
      values[key]=reference.nutrients[key]*factor;
      nutrientSources[key]={type:'dataset',foodId:reference.id,source:reference.source,sourceUrl:reference.sourceUrl||null,scaleToServing:factor};
    }else nutrientSources[key]={type:values[key]===null?'unknown':'uploaded-estimate',source:food.source,sourceUrl:food.sourceUrl};
  }
  const additionalNutrients=Object.fromEntries(Object.entries(food.additionalNutrients||{}).map(([key,entry])=>{
    const primaryValue=reference?.additionalNutrients?.[key]?.value;
    return [key,Number.isFinite(primaryValue)?{...entry,value:primaryValue*factor,source:reference.source}:{...entry,source:food.source}];
  }));
  const fallbackNutrients=Object.keys(values).filter(k=>nutrientSources[k].type==='uploaded-estimate');
  return {...food,nutrients:values,additionalNutrients,nutrientSources,fallbackNutrients,
    primaryReference:reference?{foodId:reference.id,source:reference.source,grams:reference.grams}:null,
    partialNutrients:(food.partialNutrients||[]).filter(k=>nutrientSources[k].type!=='dataset'),
    source:reference?`${reference.source}${fallbackNutrients.length?' · uploaded estimates fill missing nutrients':''}`:food.source,
    sourceUrl:reference?.sourceUrl||food.sourceUrl,
    sourceUrls:[...new Set([reference?.sourceUrl,...(food.sourceUrls||[])].filter(Boolean))],
    basis:`IFCT/USDA values take priority for reviewed matches with compatible food form and weight. ${reference?`Matched ${reference.id}, normalized from ${reference.grams} g to ${servingGrams} g. `:'No compatible primary dataset match; using uploaded estimates. '}${(food.basis||'').replace('Vitamin K uses K1 only.','Fallback vitamin K uses K1 only.')}`};
}
