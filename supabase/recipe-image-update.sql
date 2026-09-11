-- Дозвіл замінювати фото рецепта.
--
-- Навіщо: фото складаються як recipe-images/<user_id>/<recipe_id>.jpg, а
-- застосунок вантажить їх з upsert. Тобто перше фото рецепта — це INSERT, а
-- кожне наступне за тим самим шляхом — UPDATE. Політики на UPDATE не було,
-- тож заміна фото завершувалась помилкою, і рецепт зберігався без нього.
--
-- Виконувати лише тим, у кого база вже створена за старою schema.sql.
-- Скрипт безпечно запускати повторно.

drop policy if exists "recipe images update own" on storage.objects;

create policy "recipe images update own" on storage.objects
  for update
  using (
    bucket_id = 'recipe-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'recipe-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
