import { defineSubjects, type GetSyllabusRequest, type Syllabus } from '@codeeaq/shared-types';

// Checked-in syllabi load instantly and never depend on web search.
// Source: NCERT textbooks as rationalised for 2023-24 onwards.
// The academic team should review these before release.

const cbse10: Syllabus = {
  board: 'cbse',
  classLevel: 10,
  source: 'curated',
  edition: 'NCERT rationalised, 2023-24 onwards',
  subjects: defineSubjects([
    {
      name: 'Mathematics',
      units: [
        {
          chapters: [
            'Real Numbers',
            'Polynomials',
            'Pair of Linear Equations in Two Variables',
            'Quadratic Equations',
            'Arithmetic Progressions',
            'Triangles',
            'Coordinate Geometry',
            'Introduction to Trigonometry',
            'Some Applications of Trigonometry',
            'Circles',
            'Areas Related to Circles',
            'Surface Areas and Volumes',
            'Statistics',
            'Probability',
          ],
        },
      ],
    },
    {
      name: 'Science',
      units: [
        {
          chapters: [
            'Chemical Reactions and Equations',
            'Acids, Bases and Salts',
            'Metals and Non-metals',
            'Carbon and its Compounds',
            'Life Processes',
            'Control and Coordination',
            'How do Organisms Reproduce?',
            'Heredity',
            'Light – Reflection and Refraction',
            'The Human Eye and the Colourful World',
            'Electricity',
            'Magnetic Effects of Electric Current',
            'Our Environment',
          ],
        },
      ],
    },
    {
      name: 'Social Science',
      units: [
        {
          unit: 'History',
          chapters: [
            'The Rise of Nationalism in Europe',
            'Nationalism in India',
            'The Making of a Global World',
            'The Age of Industrialisation',
            'Print Culture and the Modern World',
          ],
        },
        {
          unit: 'Geography',
          chapters: [
            'Resources and Development',
            'Forest and Wildlife Resources',
            'Water Resources',
            'Agriculture',
            'Minerals and Energy Resources',
            'Manufacturing Industries',
            'Lifelines of National Economy',
          ],
        },
        {
          unit: 'Political Science',
          chapters: [
            'Power-sharing',
            'Federalism',
            'Gender, Religion and Caste',
            'Political Parties',
            'Outcomes of Democracy',
          ],
        },
        {
          unit: 'Economics',
          chapters: [
            'Development',
            'Sectors of the Indian Economy',
            'Money and Credit',
            'Globalisation and the Indian Economy',
            'Consumer Rights',
          ],
        },
      ],
    },
    {
      name: 'English',
      units: [
        {
          unit: 'First Flight – Prose',
          chapters: [
            'A Letter to God',
            'Nelson Mandela: Long Walk to Freedom',
            'Two Stories about Flying',
            'From the Diary of Anne Frank',
            'Glimpses of India',
            'Mijbil the Otter',
            'Madam Rides the Bus',
            'The Sermon at Benares',
            'The Proposal',
          ],
        },
        {
          unit: 'First Flight – Poems',
          chapters: [
            'Dust of Snow',
            'Fire and Ice',
            'A Tiger in the Zoo',
            'How to Tell Wild Animals',
            'The Ball Poem',
            'Amanda!',
            'The Trees',
            'Fog',
            'The Tale of Custard the Dragon',
            'For Anne Gregory',
          ],
        },
        {
          unit: 'Footprints without Feet',
          chapters: [
            'A Triumph of Surgery',
            "The Thief's Story",
            'The Midnight Visitor',
            'A Question of Trust',
            'Footprints without Feet',
            'The Making of a Scientist',
            'The Necklace',
            'Bholi',
            'The Book That Saved the Earth',
          ],
        },
      ],
    },
    {
      name: 'Hindi (Course A)',
      units: [
        {
          unit: 'क्षितिज भाग 2 – काव्य खंड',
          chapters: [
            'सूरदास – पद',
            'तुलसीदास – राम-लक्ष्मण-परशुराम संवाद',
            'जयशंकर प्रसाद – आत्मकथ्य',
            'सूर्यकांत त्रिपाठी निराला – उत्साह, अट नहीं रही है',
            'नागार्जुन – यह दंतुरित मुसकान, फसल',
            'मंगलेश डबराल – संगतकार',
          ],
        },
        {
          unit: 'क्षितिज भाग 2 – गद्य खंड',
          chapters: [
            'नेताजी का चश्मा',
            'बालगोबिन भगत',
            'लखनवी अंदाज़',
            'एक कहानी यह भी',
            'नौबतखाने में इबादत',
            'संस्कृति',
          ],
        },
        {
          unit: 'कृतिका भाग 2',
          chapters: ['माता का अँचल', 'साना-साना हाथ जोड़ि', 'मैं क्यों लिखता हूँ?'],
        },
      ],
    },
  ]),
};

const curated: Syllabus[] = [cbse10];

export function findCuratedSyllabus({ board, classLevel, stream }: GetSyllabusRequest): Syllabus | undefined {
  return curated.find((s) => s.board === board && s.classLevel === classLevel && s.stream === stream);
}
