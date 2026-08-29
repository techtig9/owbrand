export type PlanId = 'free' | 'starter' | 'pro' | 'business';
export type UserRole = 'user' | 'admin';
export interface User { id:string; name:string; email:string; role:UserRole; createdAt:string; }
export interface Brand { id:string; userId:string; workspaceId?:string|null; name:string; logoUrl:string|null; brandColors:string[]; brandFonts:string[]; description:string; createdAt:string; }
export interface BrandProfile { brandId:string; industry:string; businessType:string; location:string; targetMarkets:string[]; goals:string[]; targetAudience:Record<string,unknown>; positioning:Record<string,unknown>; personality:string[]; tone:string[]; voice:string; story:string; usp:string; competitors:unknown[]; }
export interface BrandGuidelines { brandId:string; colors:Record<string,unknown>; typography:Record<string,unknown>; photography:Record<string,unknown>; logoRules:Record<string,unknown>; doRules:string[]; dontRules:string[]; preferredWords:string[]; avoidedWords:string[]; }
export interface Product { id:string; brandId:string; name:string; slug:string|null; description:string; category:string; price:number|null; currency:string; sku:string|null; stock:number; features:string[]; benefits:string[]; specifications:Record<string,unknown>; metadata:Record<string,unknown>; status:string; createdAt:string; updatedAt:string; }
export type ContentAssetType = 'photo'|'post'|'logo'|'content'|'reel'|'video'|'ad';
export type ContentAssetStatus = 'draft'|'approved'|'published'|'failed';
export interface ContentAsset { id:string; userId:string; brandId:string; productId?:string|null; type:ContentAssetType; url:string|null; caption:string|null; status:ContentAssetStatus; createdAt:string; }
export type SocialPlatform = 'facebook'|'instagram'|'tiktok'|'youtube'|'linkedin'|'pinterest'|'x';
export type ScheduledPostStatus = 'queued'|'published'|'failed'|'cancelled';
export interface ScheduledPost { id:string; userId:string; contentAssetId:string; platform:SocialPlatform; scheduledAt:string; status:ScheduledPostStatus; }
export interface Campaign { id:string; brandId:string; name:string; objective:string; status:string; budget:number|null; startAt:string|null; endAt:string|null; strategy:Record<string,unknown>; createdAt:string; }
export interface AIRecommendation { id:string; brandId:string; title:string; recommendation:string; priority:string; status:string; createdAt:string; }
export interface Template { id:string; category:string; name:string; thumbnail:string|null; }
export interface Subscription { id:string; userId:string; plan:PlanId; status:'active'|'past_due'|'cancelled'|'trialing'; provider:'paddle'; paddleSubscriptionId:string|null; paddleCustomerId:string|null; creditsRemaining:number; renewsAt:string|null; }
export type DeploymentProvider='vercel'|'netlify'; export type DeploymentStatus='pending'|'building'|'live'|'failed';
export interface Deployment { id:string; projectId:string; provider:DeploymentProvider; deploymentUrl:string|null; status:DeploymentStatus; }
export interface Payment { id:string; userId:string; paddleTransactionId:string; amount:number; status:string; createdAt:string; }
export type FeatureAction = 'generate_website'|'generate_website_from_url'|'regenerate_website'|'generate_landing_page'|'generate_page'|'generate_section'|'ai_edit'|'change_theme'|'generate_logo'|'generate_photo'|'generate_post'|'generate_content'|'generate_reel'|'schedule_post'|'voice_prompt'|'export_code'|'deploy'|'build_brand'|'generate_video'|'create_campaign';
