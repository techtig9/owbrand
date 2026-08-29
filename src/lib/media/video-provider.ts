export type VideoGenerationInput={prompt:string;sourceImageUrls:string[];durationSeconds:number;aspectRatio:string;metadata?:Record<string,unknown>};
export type VideoGenerationResult={provider:string;jobId:string;status:string;outputUrl?:string;metadata?:Record<string,unknown>};

/** Server-only video adapter. The provider endpoint accepts JSON and returns a provider job. */
export async function submitProductVideo(input:VideoGenerationInput):Promise<VideoGenerationResult>{
 const url=process.env.VIDEO_PROVIDER_URL; const apiKey=process.env.VIDEO_PROVIDER_API_KEY;
 if(!url||!apiKey)throw new Error('Video generation provider is not configured. Set VIDEO_PROVIDER_URL and VIDEO_PROVIDER_API_KEY.');
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${apiKey}`},body:JSON.stringify(input)});
 if(!r.ok)throw new Error(`Video provider returned ${r.status}.`); const d=await r.json();
 if(!d.jobId)throw new Error('Video provider returned an invalid job response.');
 return {provider:process.env.VIDEO_PROVIDER||'custom',jobId:String(d.jobId),status:d.status||'queued',outputUrl:d.outputUrl,metadata:d.metadata};
}
