export interface RateLimitResult { allowed:boolean; remaining:number; retryAfterSeconds:number }
const buckets = new Map<string,{count:number;resetAt:number}>();
export function rateLimit(key:string,limit=60,windowSeconds=60):RateLimitResult{
 const now=Date.now(); const cur=buckets.get(key);
 if(!cur||cur.resetAt<=now){buckets.set(key,{count:1,resetAt:now+windowSeconds*1000});return {allowed:true,remaining:limit-1,retryAfterSeconds:windowSeconds};}
 cur.count++; return {allowed:cur.count<=limit,remaining:Math.max(0,limit-cur.count),retryAfterSeconds:Math.max(1,Math.ceil((cur.resetAt-now)/1000))};
}
