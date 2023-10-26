namespace ecbot_puller.Models
{
    public class Changes
    {
        public int Updated { get; set; }
        public int Removed { get; set; }
        public int Added { get; set; }
        public int Readded { get; set; }

        public bool ChangesDetected => Updated > 0 || Removed > 0 || Added > 0 || Readded > 0;
    }
}
