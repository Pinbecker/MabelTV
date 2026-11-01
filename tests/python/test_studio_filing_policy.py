from tests.python.library_test_support import *
from mabeltv_backend.studio_filing_policy import collection_members, movie_folder


class StudioFilingPolicyTests(unittest.TestCase):
    def title(self, name, kids=False):
        return {'category':'kids' if kids else 'films','metadata':{'title':name,'media_type':'movie'}}

    def test_standalone_films_are_loose_and_unrequested_categories_are_removed(self):
        cases = [('Arrival','Films/Arrival (2016)/Arrival (2016).mkv','Films'),
                 ('The Prince of Egypt','Kids/Films/DreamWorks/The Prince of Egypt/The Prince of Egypt.mp4','Kids/Films'),
                 ('The Grinch','Kids/Films/Christmas/The Grinch/The Grinch.mp4','Kids/Films')]
        for title,source,target in cases:
            self.assertEqual(str(movie_folder(self.title(title,source.startswith('Kids/')),{},source)),target)

    def test_only_real_franchises_create_film_folders(self):
        details={'belongs_to_collection':{'id':1241,'name':'Harry Potter Collection'}}
        self.assertEqual(str(movie_folder(self.title('Harry Potter and the Chamber of Secrets'),details,
            'Films/Harry Potter and the Chamber of Secrets (2002)/Harry Potter and the Chamber of Secrets (2002).mkv', 2)), 'Films/Harry Potter')

    def test_one_film_from_a_franchise_stays_loose(self):
        details = {'belongs_to_collection': {'id': 1241, 'name': 'Harry Potter Collection'}}
        self.assertEqual(str(movie_folder(self.title('Harry Potter'), details,
            'Films/Harry Potter/Harry Potter.mp4', 1)), 'Films')

    def test_collection_counts_distinct_films_not_multiple_copies(self):
        first = {**self.title('Harry Potter'), 'id':'one', 'path':'Films/Harry Potter/First.mp4'}
        first['metadata']['tmdb_id'] = 1
        copy = {**first, 'id':'copy', 'path':'Films/Harry Potter/First [4K].mkv'}
        second = {**self.title('Harry Potter 2'), 'id':'two', 'path':'Films/Second.mp4'}
        second['metadata']['tmdb_id'] = 2
        collection = {'id':1241,'name':'Harry Potter Collection'}
        record = {'id':'two','collection':{**collection,'matchKey':'movie:2'}}
        self.assertEqual(len(collection_members(first,collection,[first,copy],[])),1)
        self.assertEqual(len(collection_members(first,collection,[first,copy,second],[record])),2)
        self.assertEqual(len(collection_members(first,collection,[first,copy],[record])),1)

    def test_mcu_stays_together_overriding_individual_subfranchises(self):
        details = {'belongs_to_collection': {'id': 131292, 'name': 'Iron Man Collection'}}
        for source in ['Films/Marvel Cinematic Universe/01 - Iron Man (2008)/Iron Man (2008).mkv',
                       'Films/MCU/01 - Iron Man (2008).mkv']:
            self.assertEqual(str(movie_folder(self.title('Iron Man'), details, source)), 'Films/MCU')

    def test_approved_kids_groups_are_flat_inside(self):
        for group,title in [('Disney','Tangled'),('Julia Donaldson','Stick Man'),('Pixar',"A Bug's Life")]:
            expected='Disney' if group=='Pixar' else group
            self.assertEqual(str(movie_folder(self.title(title,True),{},f'Kids/Films/{group}/{title}/{title}.mp4')),
                             'Kids/Films/'+expected)

    def test_disney_and_julia_can_be_recognised_outside_their_group(self):
        disney={'production_companies':[{'name':'Walt Disney Pictures'}], 'genres':[{'id':10751}],
                'release_dates':{'results':[{'iso_3166_1':'GB','release_dates':[{'certification':'PG'}]}]}}
        julia={'credits':{'crew':[{'name':'Julia Donaldson','department':'Writing'}]}}
        self.assertEqual(str(movie_folder(self.title('Tangled'),disney,'Films/Tangled.mp4')),'Kids/Films/Disney')
        self.assertEqual(str(movie_folder(self.title('Stick Man'),julia,'Films/Stick Man.mp4')),'Kids/Films/Julia Donaldson')
