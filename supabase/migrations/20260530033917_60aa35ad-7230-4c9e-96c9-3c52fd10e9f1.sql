
ALTER TABLE public.team_settings
  ADD COLUMN IF NOT EXISTS blocked_keywords text[] NOT NULL DEFAULT ARRAY[
    'out of the blue','county','properties','purchasing','selling','investment',
    'we buy house','we buy houses','sell house','house to sell','sell home','home to sell',
    'your place','your house','abandoned','condemned','probate','estate sale','fixer upper',
    'bid','loan','mortgage','debt','foreclosure','wholesale','distressed','pre-foreclosure',
    'tax lien','credit repair','debt relief','bankruptcy','collections','settlement','lien',
    'payday','refinance','credit card offers','consolidate debt','offer','urgent','fast cash',
    'free','guaranteed','no obligation','act now','limited time','exclusive deal',
    'click here','click below','risk free','no cost','congratulations','winner','selected',
    'get rich','no purchase necessary','while supplies last','once in a lifetime',
    'order now','apply now','do it today','get started now','100% free','free gift','free money',
    'as seen on','bargain','incredible deal','prize','promise','satisfaction guaranteed',
    'trial','unlimited','ammo','ammunition','bullet','firearm','gun','gunpowder',
    'pistol','revolver','rifle','shotgun','silencer','vape','e-cigarette',
    'cannabis','cbd','kratom','marijuana','weed','thc','gambling','casino','betting',
    'jackpot','lottery','miracle cure','weight loss','lose weight','secret formula',
    'diet pill','no exercise required','make money','financial freedom','work from home',
    'earn extra cash','earn extra money','get paid','double your cash','additional income'
  ]::text[];

-- Backfill any existing rows that may have been NULL prior to default existing
UPDATE public.team_settings SET blocked_keywords = blocked_keywords WHERE blocked_keywords IS NULL;
