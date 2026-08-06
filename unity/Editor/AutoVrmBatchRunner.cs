#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UniGLTF;
using UniHumanoid;
using UniVRM10;
using UnityEditor;
using UnityEngine;

namespace AutoVrmConverter
{
    [Serializable]
    internal sealed class ConversionJob
    {
        public int version;
        public string packageName;
        public string author;
        public string modelPath;
        public string[] animationPaths;
        public string outputDirectory;
        public string reportPath;
        public string sourceAssetRoot;
    }

    [Serializable]
    internal sealed class OutputRecord
    {
        public string type;
        public string source;
        public string output;
        public string status;
        public string message;
    }

    [Serializable]
    internal sealed class ConversionResult
    {
        public string status;
        public string startedAt;
        public string finishedAt;
        public string modelAsset;
        public bool humanoidAvatar;
        public int convertedMaterials;
        public int exportedAnimations;
        public List<string> warnings = new List<string>();
        public List<OutputRecord> outputs = new List<OutputRecord>();
    }

    public static class BatchRunner
    {
        private const string JobArgument = "-autovrmJob";

        public static void Run()
        {
            var result = new ConversionResult
            {
                status = "running",
                startedAt = DateTime.UtcNow.ToString("O"),
            };

            ConversionJob job = null;
            try
            {
                var jobPath = ReadArgument(JobArgument);
                if (string.IsNullOrWhiteSpace(jobPath) || !File.Exists(jobPath))
                {
                    throw new FileNotFoundException("O argumento -autovrmJob não aponta para um job.json válido.", jobPath);
                }

                job = JsonUtility.FromJson<ConversionJob>(File.ReadAllText(jobPath));
                if (job == null || string.IsNullOrWhiteSpace(job.outputDirectory) || string.IsNullOrWhiteSpace(job.reportPath))
                {
                    throw new InvalidDataException("job.json inválido ou incompleto.");
                }

                Directory.CreateDirectory(job.outputDirectory);
                Directory.CreateDirectory(Path.GetDirectoryName(job.reportPath) ?? job.outputDirectory);

                Debug.Log($"[AutoVRM] Iniciando conversão de {job.packageName}");
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);

                var modelAssetPath = ResolveAssetPath(job.sourceAssetRoot, job.modelPath);
                result.modelAsset = modelAssetPath;

                var modelPrefab = PrepareModelAsset(modelAssetPath, result);
                if (modelPrefab == null)
                {
                    throw new InvalidOperationException($"Não foi possível carregar um GameObject de modelo em: {modelAssetPath}");
                }

                var modelAvatar = FindAvatar(modelAssetPath, modelPrefab);
                result.humanoidAvatar = modelAvatar != null && modelAvatar.isHuman && modelAvatar.isValid;
                if (!result.humanoidAvatar)
                {
                    throw new InvalidOperationException("O modelo não gerou um Avatar Humanoid válido. Corrija o mapeamento de ossos no Unity.");
                }

                ConfigureAnimationImporters(job, modelAvatar, result);
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);

                var modelOutput = ExportModel(job, modelAssetPath, modelPrefab, modelAvatar, result);
                if (!string.IsNullOrEmpty(modelOutput))
                {
                    result.outputs.Add(new OutputRecord
                    {
                        type = "vrm",
                        source = modelAssetPath,
                        output = modelOutput,
                        status = "success",
                        message = "Modelo humanoide exportado como VRM 1.0.",
                    });
                }

                ExportAnimations(job, modelPrefab, modelAvatar, result);
                result.status = result.outputs.Any(x => x.status == "success") ? "success" : "failed";
            }
            catch (Exception ex)
            {
                result.status = "failed";
                result.warnings.Add(ex.Message);
                Debug.LogException(ex);
            }
            finally
            {
                result.finishedAt = DateTime.UtcNow.ToString("O");
                if (job != null && !string.IsNullOrWhiteSpace(job.reportPath))
                {
                    try
                    {
                        File.WriteAllText(job.reportPath, JsonUtility.ToJson(result, true));
                        Debug.Log($"[AutoVRM] Relatório salvo: {job.reportPath}");
                    }
                    catch (Exception reportException)
                    {
                        Debug.LogException(reportException);
                    }
                }

                AssetDatabase.SaveAssets();
                EditorApplication.Exit(result.status == "success" ? 0 : 1);
            }
        }

        private static string ReadArgument(string name)
        {
            var args = Environment.GetCommandLineArgs();
            for (var i = 0; i < args.Length - 1; i++)
            {
                if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
            }
            return null;
        }

        private static string ResolveAssetPath(string root, string relative)
        {
            var normalizedRoot = string.IsNullOrWhiteSpace(root) ? "Assets/AutoVrmInput" : root.TrimEnd('/', '\\');
            if (string.IsNullOrWhiteSpace(relative)) return FindBestModelAsset(normalizedRoot);
            return $"{normalizedRoot}/{relative.Replace('\\', '/').TrimStart('/')}";
        }

        private static string FindBestModelAsset(string root)
        {
            var candidates = AssetDatabase.FindAssets("t:GameObject", new[] { root })
                .Select(AssetDatabase.GUIDToAssetPath)
                .Where(path => path.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase)
                    || path.EndsWith(".fbx", StringComparison.OrdinalIgnoreCase)
                    || path.EndsWith(".vrm", StringComparison.OrdinalIgnoreCase))
                .ToList();

            foreach (var candidate in candidates)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(candidate);
                if (prefab != null && prefab.GetComponentInChildren<SkinnedMeshRenderer>(true) != null) return candidate;
            }
            return candidates.FirstOrDefault();
        }

        private static GameObject PrepareModelAsset(string modelAssetPath, ConversionResult result)
        {
            if (string.IsNullOrWhiteSpace(modelAssetPath)) return null;

            var extension = Path.GetExtension(modelAssetPath).ToLowerInvariant();
            if (extension == ".fbx")
            {
                TryConfigureHumanoidImporter(modelAssetPath, null, false, result);
            }
            else if (extension == ".prefab")
            {
                foreach (var dependency in AssetDatabase.GetDependencies(modelAssetPath, true)
                             .Where(path => path.EndsWith(".fbx", StringComparison.OrdinalIgnoreCase)))
                {
                    if (TryConfigureHumanoidImporter(dependency, null, false, result)) break;
                }
            }

            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(modelAssetPath);
            if (prefab != null) return prefab;

            result.warnings.Add($"O candidato principal não pôde ser carregado: {modelAssetPath}");
            var fallback = FindBestModelAsset(Path.GetDirectoryName(modelAssetPath)?.Replace('\\', '/') ?? "Assets/AutoVrmInput");
            return string.IsNullOrWhiteSpace(fallback) ? null : AssetDatabase.LoadAssetAtPath<GameObject>(fallback);
        }

        private static bool TryConfigureHumanoidImporter(string assetPath, Avatar sourceAvatar, bool copyAvatar, ConversionResult result)
        {
            if (!(AssetImporter.GetAtPath(assetPath) is ModelImporter importer)) return false;
            try
            {
                importer.importAnimation = true;
                importer.animationType = ModelImporterAnimationType.Human;
                if (copyAvatar && sourceAvatar != null)
                {
                    importer.avatarSetup = ModelImporterAvatarSetup.CopyFromOther;
                    importer.sourceAvatar = sourceAvatar;
                }
                else
                {
                    importer.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
                }
                importer.SaveAndReimport();
                return true;
            }
            catch (Exception ex)
            {
                result.warnings.Add($"Falha ao configurar Humanoid em {assetPath}: {ex.Message}");
                return false;
            }
        }

        private static Avatar FindAvatar(string modelAssetPath, GameObject prefab)
        {
            var animator = prefab.GetComponentInChildren<Animator>(true);
            if (animator != null && animator.avatar != null) return animator.avatar;

            var avatar = AssetDatabase.LoadAllAssetsAtPath(modelAssetPath).OfType<Avatar>().FirstOrDefault(x => x.isValid && x.isHuman);
            if (avatar != null) return avatar;

            foreach (var dependency in AssetDatabase.GetDependencies(modelAssetPath, true))
            {
                avatar = AssetDatabase.LoadAllAssetsAtPath(dependency).OfType<Avatar>().FirstOrDefault(x => x.isValid && x.isHuman);
                if (avatar != null) return avatar;
            }
            return null;
        }

        private static void ConfigureAnimationImporters(ConversionJob job, Avatar modelAvatar, ConversionResult result)
        {
            foreach (var relative in job.animationPaths ?? Array.Empty<string>())
            {
                var assetPath = ResolveAssetPath(job.sourceAssetRoot, relative);
                if (!assetPath.EndsWith(".fbx", StringComparison.OrdinalIgnoreCase)) continue;
                if (string.Equals(assetPath, result.modelAsset, StringComparison.OrdinalIgnoreCase)) continue;
                TryConfigureHumanoidImporter(assetPath, modelAvatar, true, result);
            }
        }

        private static GameObject InstantiateModel(GameObject prefab, Avatar avatar)
        {
            var instance = UnityEngine.Object.Instantiate(prefab);
            instance.name = prefab.name;
            instance.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
            instance.transform.localScale = Vector3.one;

            var animator = instance.GetComponent<Animator>() ?? instance.GetComponentInChildren<Animator>(true);
            if (animator == null) animator = instance.AddComponent<Animator>();
            if (animator.avatar == null) animator.avatar = avatar;
            animator.applyRootMotion = false;
            return instance;
        }

        private static int NormalizeMaterials(GameObject root, ConversionResult result)
        {
            var converted = 0;
            var standard = Shader.Find("Standard");
            if (standard == null)
            {
                result.warnings.Add("Shader Standard não foi encontrado; materiais personalizados não foram normalizados.");
                return 0;
            }

            foreach (var renderer in root.GetComponentsInChildren<Renderer>(true))
            {
                var materials = renderer.sharedMaterials;
                var changed = false;
                for (var i = 0; i < materials.Length; i++)
                {
                    var material = materials[i];
                    if (material == null) continue;
                    var shaderName = material.shader != null ? material.shader.name : string.Empty;
                    if (shaderName.IndexOf("Standard", StringComparison.OrdinalIgnoreCase) >= 0
                        || shaderName.IndexOf("MToon", StringComparison.OrdinalIgnoreCase) >= 0
                        || shaderName.IndexOf("Unlit", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        continue;
                    }

                    var replacement = new Material(standard) { name = material.name + "_AutoPBR" };
                    if (material.HasProperty("_MainTex")) replacement.mainTexture = material.GetTexture("_MainTex");
                    if (material.HasProperty("_BaseMap")) replacement.mainTexture = material.GetTexture("_BaseMap");
                    if (material.HasProperty("_Color")) replacement.color = material.GetColor("_Color");
                    else if (material.HasProperty("_BaseColor")) replacement.color = material.GetColor("_BaseColor");
                    materials[i] = replacement;
                    changed = true;
                    converted++;
                }
                if (changed) renderer.sharedMaterials = materials;
            }

            return converted;
        }

        private static string ExportModel(ConversionJob job, string modelAssetPath, GameObject prefab, Avatar avatar, ConversionResult result)
        {
            var originalExtension = Path.GetExtension(modelAssetPath).ToLowerInvariant();
            var outputName = SafeFileName(string.IsNullOrWhiteSpace(job.packageName) ? prefab.name : job.packageName) + ".vrm";
            var outputPath = Path.Combine(job.outputDirectory, outputName);

            if (originalExtension == ".vrm")
            {
                var absolute = AssetPathToFullPath(modelAssetPath);
                File.Copy(absolute, outputPath, true);
                return outputPath;
            }

            var root = InstantiateModel(prefab, avatar);
            try
            {
                result.convertedMaterials = NormalizeMaterials(root, result);

                using var arrayManager = new NativeArrayManager();
                var settings = ScriptableObject.CreateInstance<VRM10ExportSettings>();
                try
                {
                    var converter = new UniVRM10.ModelExporter();
                    var model = converter.Export(settings.MeshExportSettings, arrayManager, root);
                    model.ConvertCoordinate(VrmLib.Coordinates.Vrm1, ignoreVrm: false);

                    using var exporter = new Vrm10Exporter(
                        settings.MeshExportSettings,
                        textureSerializer: new EditorTextureSerializer());
                    var option = new VrmLib.ExportArgs { sparse = settings.MorphTargetUseSparse };
                    var meta = new VRM10ObjectMeta
                    {
                        Name = string.IsNullOrWhiteSpace(job.packageName) ? prefab.name : job.packageName,
                        Version = "1.0",
                        Authors = new List<string> { string.IsNullOrWhiteSpace(job.author) ? "Auto VRM Converter" : job.author },
                        Redistribution = false,
                    };

                    exporter.Export(root, model, converter, option, meta);
                    File.WriteAllBytes(outputPath, exporter.Storage.ToGlbBytes());
                    Debug.Log($"[AutoVRM] VRM exportado: {outputPath}");
                }
                finally
                {
                    UnityEngine.Object.DestroyImmediate(settings);
                }
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }

            return outputPath;
        }

        private static void ExportAnimations(ConversionJob job, GameObject modelPrefab, Avatar avatar, ConversionResult result)
        {
            var usedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var relative in job.animationPaths ?? Array.Empty<string>())
            {
                var assetPath = ResolveAssetPath(job.sourceAssetRoot, relative);
                var extension = Path.GetExtension(assetPath).ToLowerInvariant();
                try
                {
                    if (extension == ".vrma")
                    {
                        var output = UniqueOutputPath(job.outputDirectory, Path.GetFileNameWithoutExtension(assetPath), ".vrma", usedNames);
                        File.Copy(AssetPathToFullPath(assetPath), output, true);
                        result.exportedAnimations++;
                        result.outputs.Add(new OutputRecord { type = "vrma", source = assetPath, output = output, status = "success", message = "VRMA existente copiado." });
                        continue;
                    }

                    if (extension == ".bvh")
                    {
                        var output = UniqueOutputPath(job.outputDirectory, Path.GetFileNameWithoutExtension(assetPath), ".vrma", usedNames);
                        File.WriteAllBytes(output, ConvertBvhToVrma(AssetPathToFullPath(assetPath)));
                        result.exportedAnimations++;
                        result.outputs.Add(new OutputRecord { type = "vrma", source = assetPath, output = output, status = "success", message = "BVH convertido para VRMA." });
                        continue;
                    }

                    var clips = AssetDatabase.LoadAllAssetsAtPath(assetPath)
                        .OfType<AnimationClip>()
                        .Where(clip => clip != null && !clip.name.StartsWith("__preview__", StringComparison.OrdinalIgnoreCase) && clip.length > 0.0001f)
                        .ToList();

                    if (clips.Count == 0 && extension == ".anim")
                    {
                        var single = AssetDatabase.LoadAssetAtPath<AnimationClip>(assetPath);
                        if (single != null) clips.Add(single);
                    }

                    if (clips.Count == 0)
                    {
                        result.outputs.Add(new OutputRecord { type = "vrma", source = assetPath, status = "skipped", message = "Nenhum AnimationClip utilizável foi encontrado." });
                        continue;
                    }

                    foreach (var clip in clips)
                    {
                        var output = UniqueOutputPath(job.outputDirectory, clip.name, ".vrma", usedNames);
                        File.WriteAllBytes(output, ConvertClipToVrma(modelPrefab, avatar, clip));
                        result.exportedAnimations++;
                        result.outputs.Add(new OutputRecord { type = "vrma", source = $"{assetPath}::{clip.name}", output = output, status = "success", message = "AnimationClip humanoide convertido para VRMA." });
                    }
                }
                catch (Exception ex)
                {
                    result.outputs.Add(new OutputRecord { type = "vrma", source = assetPath, status = "failed", message = ex.Message });
                    result.warnings.Add($"Falha em {assetPath}: {ex.Message}");
                    Debug.LogException(ex);
                }
            }
        }

        private static byte[] ConvertClipToVrma(GameObject modelPrefab, Avatar avatar, AnimationClip clip)
        {
            var root = InstantiateModel(modelPrefab, avatar);
            try
            {
                var animator = root.GetComponent<Animator>() ?? root.GetComponentInChildren<Animator>(true);
                if (animator == null || animator.avatar == null || !animator.avatar.isHuman)
                {
                    throw new InvalidOperationException("O modelo de retarget não possui Animator Humanoid válido.");
                }

                var map = BuildHumanBoneMap(animator);
                if (!map.TryGetValue(HumanBodyBones.Hips, out var hips)) throw new InvalidOperationException("Osso Hips não foi encontrado.");

                var data = new ExportingGltfData();
                using var exporter = new VrmAnimationExporter(data, new GltfExportSettings());
                exporter.Prepare(root);
                exporter.Export(vrma =>
                {
                    vrma.SetPositionBoneAndParent(hips, root.transform);
                    foreach (var pair in map)
                    {
                        var vrmBone = Vrm10HumanoidBoneSpecification.ConvertFromUnityBone(pair.Key);
                        var parent = GetParentBone(map, vrmBone) ?? root.transform;
                        vrma.AddRotationBoneAndParent(pair.Key, pair.Value, parent);
                    }

                    var frameRate = Mathf.Clamp(clip.frameRate > 0 ? clip.frameRate : 30f, 1f, 120f);
                    var frameCount = Mathf.Max(1, Mathf.CeilToInt(clip.length * frameRate));
                    for (var frame = 0; frame <= frameCount; frame++)
                    {
                        var time = Mathf.Min(clip.length, frame / frameRate);
                        clip.SampleAnimation(root, time);
                        vrma.AddFrame(TimeSpan.FromSeconds(time));
                    }
                });
                return data.ToGlbBytes();
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static byte[] ConvertBvhToVrma(string path)
        {
            var bvh = new BvhImporterContext();
            bvh.Parse(path, File.ReadAllText(path));
            bvh.Load();
            try
            {
                var data = new ExportingGltfData();
                using var exporter = new VrmAnimationExporter(data, new GltfExportSettings());
                exporter.Prepare(bvh.Root.gameObject);
                exporter.Export(vrma =>
                {
                    var animator = bvh.Root.GetComponent<Animator>();
                    var map = BuildHumanBoneMap(animator);
                    vrma.SetPositionBoneAndParent(map[HumanBodyBones.Hips], bvh.Root.transform);
                    foreach (var pair in map)
                    {
                        var vrmBone = Vrm10HumanoidBoneSpecification.ConvertFromUnityBone(pair.Key);
                        var parent = GetParentBone(map, vrmBone) ?? bvh.Root.transform;
                        vrma.AddRotationBoneAndParent(pair.Key, pair.Value, parent);
                    }

                    var animation = bvh.Root.GetComponent<Animation>();
                    var clip = animation.clip;
                    var state = animation[clip.name];
                    var time = TimeSpan.Zero;
                    for (var i = 0; i < bvh.Bvh.FrameCount; i++, time += bvh.Bvh.FrameTime)
                    {
                        state.time = (float)time.TotalSeconds;
                        animation.Sample();
                        vrma.AddFrame(time);
                    }
                });
                return data.ToGlbBytes();
            }
            finally
            {
                if (bvh.Root != null) UnityEngine.Object.DestroyImmediate(bvh.Root.gameObject);
            }
        }

        private static Dictionary<HumanBodyBones, Transform> BuildHumanBoneMap(Animator animator)
        {
            var map = new Dictionary<HumanBodyBones, Transform>();
            foreach (HumanBodyBones bone in Enum.GetValues(typeof(HumanBodyBones)))
            {
                if (bone == HumanBodyBones.LastBone) continue;
                var transform = animator.GetBoneTransform(bone);
                if (transform != null) map[bone] = transform;
            }
            return map;
        }

        private static Transform GetParentBone(Dictionary<HumanBodyBones, Transform> map, Vrm10HumanoidBones bone)
        {
            while (bone != Vrm10HumanoidBones.Hips)
            {
                var parentBone = Vrm10HumanoidBoneSpecification.GetDefine(bone).ParentBone.Value;
                var unityParent = Vrm10HumanoidBoneSpecification.ConvertToUnityBone(parentBone);
                if (map.TryGetValue(unityParent, out var found)) return found;
                bone = parentBone;
            }
            return null;
        }

        private static string AssetPathToFullPath(string assetPath)
        {
            var projectRoot = Directory.GetParent(Application.dataPath)?.FullName;
            if (string.IsNullOrWhiteSpace(projectRoot)) throw new DirectoryNotFoundException("A raiz do projeto Unity não foi encontrada.");
            return Path.GetFullPath(Path.Combine(projectRoot, assetPath.Replace('/', Path.DirectorySeparatorChar)));
        }

        private static string UniqueOutputPath(string directory, string name, string extension, HashSet<string> used)
        {
            var safe = SafeFileName(name);
            var candidate = safe;
            var index = 2;
            while (!used.Add(candidate)) candidate = $"{safe}-{index++}";
            return Path.Combine(directory, candidate + extension);
        }

        private static string SafeFileName(string value)
        {
            var invalid = Path.GetInvalidFileNameChars();
            var safe = new string((value ?? string.Empty).Select(ch => invalid.Contains(ch) ? '-' : ch).ToArray()).Trim();
            return string.IsNullOrWhiteSpace(safe) ? "animation" : safe;
        }
    }
}
#endif
