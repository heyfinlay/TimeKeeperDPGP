Initialising login role...
Creating shadow database...
Initialising schema...
v2.57.3: Pulling from supabase/realtime
3a2a71eb1ec8: Pulling fs layer
db76f53552c8: Pulling fs layer
634fd4b6061b: Pulling fs layer
09531d75fe65: Pulling fs layer
b28ab5d5db9f: Pulling fs layer
0fa6f7a111b6: Pulling fs layer
508f2d3c6d32: Pulling fs layer
db76f53552c8: Download complete
508f2d3c6d32: Download complete
3a2a71eb1ec8: Download complete
0fa6f7a111b6: Download complete
09531d75fe65: Download complete
b28ab5d5db9f: Download complete
634fd4b6061b: Download complete
db76f53552c8: Pull complete
508f2d3c6d32: Pull complete
09531d75fe65: Pull complete
634fd4b6061b: Pull complete
3a2a71eb1ec8: Pull complete
0fa6f7a111b6: Pull complete
b28ab5d5db9f: Pull complete
Digest: sha256:2765b566de5b0ace216010580471962f3226d422f9b4f3381a3881a9db699637
Status: Downloaded newer image for public.ecr.aws/supabase/realtime:v2.57.3
v1.28.2: Pulling from supabase/storage-api
33792457c266: Pulling fs layer
c2fe130f4aab: Pulling fs layer
ca61183d4755: Pulling fs layer
51314662349c: Pulling fs layer
c6d71ddddb42: Pulling fs layer
b7ddfb8056ed: Pulling fs layer
57afff26f0db: Pulling fs layer
8db7c81b9050: Pulling fs layer
f3ce53e4221f: Pulling fs layer
ebd01ca1d966: Pulling fs layer
51314662349c: Download complete
8db7c81b9050: Download complete
b7ddfb8056ed: Download complete
ca61183d4755: Download complete
33792457c266: Download complete
f3ce53e4221f: Download complete
c2fe130f4aab: Download complete
c2fe130f4aab: Pull complete
57afff26f0db: Download complete
ebd01ca1d966: Download complete
b7ddfb8056ed: Pull complete
f3ce53e4221f: Pull complete
ebd01ca1d966: Pull complete
c6d71ddddb42: Download complete
51314662349c: Pull complete
c6d71ddddb42: Pull complete
8db7c81b9050: Pull complete
ca61183d4755: Pull complete
33792457c266: Pull complete
57afff26f0db: Pull complete
Digest: sha256:54c4ef1ceafb998d1335ff7f9d112aa4e5235a1a6eea8486d30bf2c18864c60e
Status: Downloaded newer image for public.ecr.aws/supabase/storage-api:v1.28.2
v2.182.1: Pulling from supabase/gotrue
b4367d85e631: Pulling fs layer
7edf146d6313: Pulling fs layer
d09180baaaf8: Pulling fs layer
df80b4516032: Pulling fs layer
c0b369640753: Pulling fs layer
b4367d85e631: Download complete
c0b369640753: Download complete
df80b4516032: Download complete
df80b4516032: Pull complete
7edf146d6313: Download complete
7edf146d6313: Pull complete
d09180baaaf8: Download complete
b4367d85e631: Pull complete
c0b369640753: Pull complete
d09180baaaf8: Pull complete
Digest: sha256:28fa2e45b9818b1b1b116f1020c1c447ec0b09c61a02039e023bf54f759e2725
Status: Downloaded newer image for public.ecr.aws/supabase/gotrue:v2.182.1
Seeding globals from roles.sql...
Applying migration 20250106_bootstrap_access_functions.sql...
ERROR: syntax error at or near "create" (SQLSTATE 42601)
At statement: 1                                         
do $$                                                   
begin                                                   
  -- Create or replace is_admin()                       
  execute $$                                            
    create or replace function public.is_admin()        
    ^                                                   
Try rerunning the command with --debug to troubleshoot the error.
